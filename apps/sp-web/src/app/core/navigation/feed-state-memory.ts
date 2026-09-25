import { DOCUMENT, ViewportScroller } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Navigation, NavigationStart, Router, Scroll } from '@angular/router';
import { filter, take } from 'rxjs';

export const RESTORE_FEED_STATE_KEY = 'restoreFeedState';

/**
 * Navigation state for in-app "Back to …" links. Browser back/forward restores
 * automatically; links must opt in so that fresh visits still start at the top.
 */
export const RESTORE_FEED_NAVIGATION_STATE: Readonly<Record<string, unknown>> = {
  [RESTORE_FEED_STATE_KEY]: true,
};

export interface FeedState<TItem> {
  readonly items: readonly TItem[];
  readonly page: number;
  readonly total: number;
  readonly hasMore: boolean;
}

export interface FeedStateEntry<TItem = unknown> {
  readonly state: FeedState<TItem>;
  readonly scrollPosition: [number, number];
}

interface StoredEntry {
  readonly entry: FeedStateEntry;
  readonly savedAt: number;
}

/** In-memory store of infinite-scroll feeds, keyed by the page URL they were loaded for. */
@Injectable({
  providedIn: 'root',
})
export class FeedStateCache {
  static readonly MAX_ENTRIES = 10;
  static readonly TTL_MS = 30 * 60 * 1000;

  private readonly router = inject(Router);
  private readonly entries = new Map<string, StoredEntry>();

  save(url: string, entry: FeedStateEntry): void {
    const key = this.normalizeUrl(url);
    // Re-inserting moves the key to the end, so the first key is always the oldest.
    this.entries.delete(key);
    this.entries.set(key, { entry, savedAt: Date.now() });

    while (this.entries.size > FeedStateCache.MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  get(url: string): FeedStateEntry | null {
    const key = this.normalizeUrl(url);
    const stored = this.entries.get(key);
    if (!stored) {
      return null;
    }

    if (Date.now() - stored.savedAt > FeedStateCache.TTL_MS) {
      this.entries.delete(key);
      return null;
    }

    return stored.entry;
  }

  /**
   * Rewrites items in every saved feed, e.g. to reflect a change made on another page.
   * Keeps each entry's expiry and eviction order; items returned unchanged stay as-is.
   */
  updateItems(update: (item: unknown) => unknown): void {
    for (const [key, stored] of this.entries) {
      const { entry } = stored;
      this.entries.set(key, {
        ...stored,
        entry: { ...entry, state: { ...entry.state, items: entry.state.items.map(update) } },
      });
    }
  }

  private normalizeUrl(url: string): string {
    try {
      return this.router.serializeUrl(this.router.parseUrl(url));
    } catch {
      return url;
    }
  }
}

export interface FeedStateMemory<TState extends FeedState<unknown>> {
  /**
   * Returns the feed saved for this URL when the page was opened by a return
   * navigation (browser back/forward or a "Back to …" link), and scrolls back to where
   * the user left once the router has finished its own scroll handling. Only the
   * first call can restore; later calls return null.
   */
  restore(): TState | null;
}

/**
 * Remembers an infinite-scroll feed when the user navigates away so that it can be
 * restored, with its scroll position, when they come back. The captured state may carry
 * extra feed-level fields (e.g. counts) alongside the items. Call from an injection context.
 */
export function injectFeedStateMemory<TState extends FeedState<unknown>>(
  captureState: () => TState,
): FeedStateMemory<TState> {
  const router = inject(Router);
  const scroller = inject(ViewportScroller);
  const cache = inject(FeedStateCache);
  const destroyRef = inject(DestroyRef);
  const document = inject(DOCUMENT);

  // Captured on NavigationStart, while the page is still rendered at its scroll position.
  let departure: { url: string; scrollPosition: [number, number] } | null = null;

  router.events
    .pipe(
      filter((event) => event instanceof NavigationStart),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe(() => {
      departure = { url: router.url, scrollPosition: scroller.getScrollPosition() };
    });

  destroyRef.onDestroy(() => {
    const state = captureState();
    if (!departure || state.items.length === 0) {
      return;
    }

    cache.save(departure.url, {
      state: { ...state, items: [...state.items] },
      scrollPosition: departure.scrollPosition,
    });
  });

  // Must be resolved now: the page is created during the navigation, but in a zoneless
  // app ngOnInit (where pages call restore()) runs after it has already finished.
  const arrival = resolveSavedEntryForNavigation(router, cache);
  let routerHasScrolled = false;
  let restoreRequested = false;

  const restoreScroll = (): void => {
    if (!arrival) {
      return;
    }
    destroyRef.onDestroy(restoreScrollPosition(document, scroller, arrival.scrollPosition));
  };

  if (arrival) {
    // Scroll only after both the router's scroll-to-top and restore(), whichever comes last.
    router.events
      .pipe(
        filter((event) => event instanceof Scroll),
        take(1),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => {
        // router.events subscribers see Scroll before the router's own scroller acts on it,
        // so wait for its scroll-to-top to run before scrolling back down.
        queueMicrotask(() => {
          routerHasScrolled = true;
          if (restoreRequested) {
            restoreScroll();
          }
        });
      });
  }

  return {
    restore(): TState | null {
      if (!arrival || restoreRequested) {
        return null;
      }

      restoreRequested = true;
      if (routerHasScrolled) {
        restoreScroll();
      }

      return arrival.state as TState;
    },
  };
}

function resolveSavedEntryForNavigation(
  router: Router,
  cache: FeedStateCache,
): FeedStateEntry | null {
  const navigation = router.currentNavigation();
  if (!navigation || !isReturnNavigation(navigation)) {
    return null;
  }

  return cache.get(router.serializeUrl(navigation.finalUrl ?? navigation.extractedUrl));
}

const SCROLL_RESTORE_TIMEOUT_MS = 5000;
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

/**
 * Scrolls to the target position, retrying as the page grows. Parts of a page can
 * still be loading when the router scrolls (e.g. a studio header that gates the
 * scene grid), in which case the browser clamps the first attempt. Gives up once the
 * position is reached, after a timeout, or as soon as the user scrolls themselves.
 * Returns a function that cancels any pending retries.
 */
function restoreScrollPosition(
  document: Document,
  scroller: ViewportScroller,
  target: [number, number],
): () => void {
  const scrollToTarget = (): boolean => {
    scroller.scrollToPosition(target, { behavior: 'instant' });
    const [x, y] = scroller.getScrollPosition();
    return Math.abs(x - target[0]) < 1 && Math.abs(y - target[1]) < 1;
  };

  const window = document.defaultView;
  if (scrollToTarget() || !window || typeof ResizeObserver === 'undefined') {
    return () => undefined;
  }

  const resizeObserver = new ResizeObserver(() => {
    if (scrollToTarget()) {
      stop();
    }
  });
  const timeoutId = window.setTimeout(() => stop(), SCROLL_RESTORE_TIMEOUT_MS);
  const stop = (): void => {
    resizeObserver.disconnect();
    window.clearTimeout(timeoutId);
    for (const eventName of USER_SCROLL_EVENTS) {
      window.removeEventListener(eventName, stop, true);
    }
  };

  resizeObserver.observe(document.body);
  for (const eventName of USER_SCROLL_EVENTS) {
    window.addEventListener(eventName, stop, { capture: true, passive: true });
  }

  return stop;
}

function isReturnNavigation(navigation: Navigation): boolean {
  return (
    navigation.trigger === 'popstate' || navigation.extras.state?.[RESTORE_FEED_STATE_KEY] === true
  );
}
