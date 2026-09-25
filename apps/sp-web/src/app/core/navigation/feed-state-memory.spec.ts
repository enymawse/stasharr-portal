import { ViewportScroller } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  NavigationEnd,
  Router,
  Scroll,
  provideRouter,
  withInMemoryScrolling,
} from '@angular/router';
import { Subject } from 'rxjs';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  FeedState,
  FeedStateCache,
  RESTORE_FEED_NAVIGATION_STATE,
  injectFeedStateMemory,
} from './feed-state-memory';

function buildState(overrides: Partial<FeedState<string>> = {}): FeedState<string> {
  return {
    items: ['a', 'b', 'c'],
    page: 3,
    total: 100,
    hasMore: true,
    ...overrides,
  };
}

describe('FeedStateCache', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function createCache(): FeedStateCache {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    return TestBed.inject(FeedStateCache);
  }

  it('returns a saved entry for the same url', () => {
    const cache = createCache();
    const entry = { state: buildState(), scrollPosition: [0, 1200] as [number, number] };

    cache.save('/studio/abc?sort=TITLE', entry);

    expect(cache.get('/studio/abc?sort=TITLE')).toEqual(entry);
  });

  it('treats equivalent url encodings as the same key', () => {
    const cache = createCache();
    const entry = { state: buildState(), scrollPosition: [0, 50] as [number, number] };

    cache.save('/studio/abc?returnTo=%2Fstudios', entry);

    expect(cache.get('/studio/abc?returnTo=/studios')).toEqual(entry);
  });

  it('returns null for unknown urls', () => {
    const cache = createCache();

    expect(cache.get('/scenes')).toBeNull();
  });

  it('expires entries after the ttl', () => {
    vi.useFakeTimers();
    const cache = createCache();
    cache.save('/scenes', { state: buildState(), scrollPosition: [0, 10] });

    vi.advanceTimersByTime(FeedStateCache.TTL_MS + 1);

    expect(cache.get('/scenes')).toBeNull();
  });

  it('updates saved items across all feeds without extending their expiry', () => {
    vi.useFakeTimers();
    const cache = createCache();
    cache.save('/scenes', { state: buildState({ items: ['a', 'b'] }), scrollPosition: [0, 10] });
    cache.save('/studios', { state: buildState({ items: ['b', 'c'] }), scrollPosition: [0, 20] });
    vi.advanceTimersByTime(FeedStateCache.TTL_MS - 1000);

    cache.updateItems((item) => (item === 'b' ? 'B' : item));

    expect(cache.get('/scenes')?.state.items).toEqual(['a', 'B']);
    expect(cache.get('/studios')?.state.items).toEqual(['B', 'c']);
    expect(cache.get('/studios')?.scrollPosition).toEqual([0, 20]);
    vi.advanceTimersByTime(2000);
    expect(cache.get('/scenes')).toBeNull();
  });

  it('evicts the least recently saved entry when full', () => {
    const cache = createCache();
    for (let i = 0; i <= FeedStateCache.MAX_ENTRIES; i += 1) {
      cache.save(`/scenes?page=${i}`, { state: buildState(), scrollPosition: [0, i] });
    }

    expect(cache.get('/scenes?page=0')).toBeNull();
    expect(cache.get(`/scenes?page=${FeedStateCache.MAX_ENTRIES}`)).not.toBeNull();
  });
});

// Mirrors the real feed pages: restore() is called from ngOnInit, which in a zoneless
// app runs after the navigation has already finished.
@Component({ template: '' })
class ListPageComponent implements OnInit {
  static current: ListPageComponent | null = null;
  static feedState: FeedState<string> = buildState();

  readonly memory = injectFeedStateMemory<FeedState<string>>(() => ListPageComponent.feedState);
  restored: FeedState<string> | null | undefined = undefined;

  constructor() {
    ListPageComponent.current = this;
  }

  ngOnInit(): void {
    this.restored = this.memory.restore();
  }
}

@Component({ template: '' })
class DetailPageComponent {}

describe('injectFeedStateMemory', () => {
  let scroller: {
    getScrollPosition: ReturnType<typeof vi.fn>;
    scrollToPosition: ReturnType<typeof vi.fn>;
    scrollToAnchor: ReturnType<typeof vi.fn>;
    setHistoryScrollRestoration: ReturnType<typeof vi.fn>;
    setOffset: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    ListPageComponent.current = null;
    ListPageComponent.feedState = buildState();
    scroller = {
      getScrollPosition: vi.fn().mockReturnValue([0, 2400]),
      scrollToPosition: vi.fn(),
      scrollToAnchor: vi.fn(),
      setHistoryScrollRestoration: vi.fn(),
      setOffset: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'list', component: ListPageComponent },
            { path: 'detail', component: DetailPageComponent },
          ],
          withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
        ),
        { provide: ViewportScroller, useValue: scroller },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Stub whose callbacks, like the real thing, stop firing once disconnected. */
  function stubResizeObserver(): Array<() => void> {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private connected = true;
        constructor(callback: () => void) {
          callbacks.push(() => {
            if (this.connected) {
              callback();
            }
          });
        }
        observe(): void {}
        disconnect(): void {
          this.connected = false;
        }
      },
    );
    return callbacks;
  }

  // RouterScroller is started by a bootstrap listener, which TestBed never runs. Stand in
  // for it the way the app wires it: it listens on the internal transition events, which
  // reach router.events subscribers first, and scrolls to the top ('top' restoration).
  // Then emit the Scroll event the router sends once a navigation settles.
  async function emitRouterScroll(router: Router): Promise<void> {
    const events = (router as unknown as { navigationTransitions: { events: Subject<unknown> } })
      .navigationTransitions.events;
    const routerScroller = events.subscribe((event) => {
      if (event instanceof Scroll) {
        scroller.scrollToPosition([0, 0], { behavior: 'instant' });
      }
    });
    events.next(new Scroll(new NavigationEnd(0, router.url, router.url), null, null));
    routerScroller.unsubscribe();
    await Promise.resolve();
  }

  it('does not restore on a fresh navigation to the page', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/list?sort=TITLE');
    await harness.navigateByUrl('/detail');

    await harness.navigateByUrl('/list?sort=TITLE');

    expect(ListPageComponent.current?.restored).toBeNull();
  });

  it('restores saved state and scroll position when returning via a back link', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/list?sort=TITLE');
    await harness.navigateByUrl('/detail');

    await router.navigateByUrl('/list?sort=TITLE', { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();
    await emitRouterScroll(router);

    expect(ListPageComponent.current?.restored).toEqual(buildState());
    expect(scroller.scrollToPosition).toHaveBeenLastCalledWith([0, 2400], {
      behavior: 'instant',
    });
  });

  it('keeps retrying the scroll while the page is still too short to reach the saved position', async () => {
    const resizeCallbacks = stubResizeObserver();
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/list');
    await harness.navigateByUrl('/detail');
    // The page has not finished rendering, so the browser clamps the first attempt.
    scroller.getScrollPosition.mockReturnValue([0, 300]);

    await router.navigateByUrl('/list', { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();
    await emitRouterScroll(router);
    // The router's scroll-to-top, then the first (clamped) restore attempt.
    expect(scroller.scrollToPosition).toHaveBeenCalledTimes(2);

    // Content arrives and the page grows tall enough.
    scroller.scrollToPosition.mockImplementation(() => {
      scroller.getScrollPosition.mockReturnValue([0, 2400]);
    });
    resizeCallbacks.forEach((callback) => callback());
    resizeCallbacks.forEach((callback) => callback());

    expect(scroller.scrollToPosition).toHaveBeenCalledTimes(3);
    expect(scroller.scrollToPosition).toHaveBeenLastCalledWith([0, 2400], { behavior: 'instant' });
    vi.unstubAllGlobals();
  });

  it('stops retrying the scroll once the user scrolls', async () => {
    const resizeCallbacks = stubResizeObserver();
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/list');
    await harness.navigateByUrl('/detail');
    scroller.getScrollPosition.mockReturnValue([0, 300]);

    await router.navigateByUrl('/list', { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();
    await emitRouterScroll(router);
    window.dispatchEvent(new Event('wheel'));
    resizeCallbacks.forEach((callback) => callback());

    expect(scroller.scrollToPosition).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('does not restore state saved for a different url', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/list?sort=TITLE');
    await harness.navigateByUrl('/detail');

    await router.navigateByUrl('/list?sort=DATE', { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();

    expect(ListPageComponent.current?.restored).toBeNull();
  });

  it('does not save a feed that has no items', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    ListPageComponent.feedState = buildState({ items: [] });
    await harness.navigateByUrl('/list');
    await harness.navigateByUrl('/detail');

    await router.navigateByUrl('/list', { state: RESTORE_FEED_NAVIGATION_STATE });
    await harness.fixture.whenStable();

    expect(ListPageComponent.current?.restored).toBeNull();
  });
});
