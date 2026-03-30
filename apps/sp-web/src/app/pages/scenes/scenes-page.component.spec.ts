import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneExplorerItem, ScenesFeedResponse } from '../../core/api/discover.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { ScenesPageComponent } from './scenes-page.component';

function buildScene(overrides: Partial<SceneExplorerItem> = {}): SceneExplorerItem {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    cardImageUrl: 'http://cdn.local/card.jpg',
    studioId: 'studio-1',
    studio: 'Studio Name',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-01',
    duration: 640,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    requestable: true,
    ...overrides,
  };
}

function buildFeedResponse(
  items: SceneExplorerItem[] = [buildScene()],
  overrides: Partial<ScenesFeedResponse> = {},
): ScenesFeedResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 24,
    hasMore: false,
    items,
    ...overrides,
  };
}

describe('ScenesPageComponent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function renderPage(initialQueryParams: Record<string, string> = {}) {
    const queryParamMap = convertToParamMap(initialQueryParams);
    const queryParamMap$ = new BehaviorSubject(queryParamMap);
    const discoverService = {
      getScenesFeed: vi.fn().mockReturnValue(of(buildFeedResponse())),
      searchSceneTags: vi.fn().mockReturnValue(of([])),
      searchPerformerStudios: vi.fn().mockReturnValue(of([])),
    };
    const activatedRoute = {
      queryParamMap: queryParamMap$.asObservable(),
      snapshot: {
        queryParamMap,
      },
    };

    await TestBed.configureTestingModule({
      imports: [ScenesPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(ScenesPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, navigateSpy };
  }

  it('initializes the canonical scenes discovery view with TRENDING sort', async () => {
    const { fixture, discoverService, navigateSpy } = await renderPage();
    const resetButton = fixture.nativeElement.querySelector(
      '.reset-filters-button',
    ) as HTMLButtonElement | null;

    expect(discoverService.getScenesFeed).toHaveBeenCalledWith(
      1,
      24,
      'TRENDING',
      'DESC',
      [],
      'OR',
      undefined,
      [],
      'ANY',
      false,
      false,
      false,
    );
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(resetButton?.disabled).toBe(true);
  });

  it('clears active filters back to the default trending discovery state', async () => {
    const { fixture, discoverService, navigateSpy } = await renderPage({
      sort: 'DATE',
      dir: 'ASC',
      fav: 'ALL',
      availability: 'IN_LIBRARY',
      stashFavPerformers: '1',
      stashFavStudios: '1',
      stashFavTags: '1',
      mode: 'AND',
      tags: 'tag-1,tag-2',
      tagNames: 'Tag One,Tag Two',
      studios: 'studio-1,studio-2',
      studioNames: 'Studio One,Studio Two',
    });
    const resetButton = fixture.nativeElement.querySelector(
      '.reset-filters-button',
    ) as HTMLButtonElement | null;

    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(false);

    resetButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(discoverService.getScenesFeed).toHaveBeenLastCalledWith(
      1,
      24,
      'TRENDING',
      'DESC',
      [],
      'OR',
      undefined,
      [],
      'ANY',
      false,
      false,
      false,
    );
    expect(navigateSpy).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: {
        sort: null,
        dir: null,
        fav: null,
        availability: null,
        lifecycle: null,
        stashFavPerformers: null,
        stashFavStudios: null,
        stashFavTags: null,
        mode: null,
        tags: null,
        tagNames: null,
        studios: null,
        studioNames: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  });
});
