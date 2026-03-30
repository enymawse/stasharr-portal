import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneItem, LibraryScenesFeedResponse } from '../../core/api/library.types';
import { LibraryPageComponent } from './library-page.component';

function buildScene(overrides: Partial<LibrarySceneItem> = {}): LibrarySceneItem {
  return {
    id: '411',
    linkedStashId: 'stash-411',
    title: 'Fresh Local Scene',
    description: 'Already in the library.',
    imageUrl: '/api/media/stash/scenes/411/screenshot',
    cardImageUrl: '/api/media/stash/scenes/411/screenshot',
    studioId: 'studio-1',
    studio: 'Archive',
    studioImageUrl: '/api/media/stash/studios/studio-1/logo',
    releaseDate: '2026-03-24',
    duration: 1800,
    type: 'SCENE',
    source: 'STASH',
    viewUrl: 'http://stash.local/scenes/411',
    ...overrides,
  };
}

function buildFeedResponse(
  items: LibrarySceneItem[] = [buildScene()],
  overrides: Partial<LibraryScenesFeedResponse> = {},
): LibraryScenesFeedResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 24,
    hasMore: false,
    items,
    ...overrides,
  };
}

describe('LibraryPageComponent', () => {
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
    const libraryService = {
      getScenesFeed: vi.fn().mockReturnValue(of(buildFeedResponse())),
      searchTags: vi.fn().mockReturnValue(of([])),
      searchStudios: vi.fn().mockReturnValue(of([])),
    };
    const activatedRoute = {
      queryParamMap: queryParamMap$.asObservable(),
      snapshot: {
        queryParamMap,
      },
    };

    await TestBed.configureTestingModule({
      imports: [LibraryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: LibraryService,
          useValue: libraryService,
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LibraryPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, libraryService, navigateSpy };
  }

  it('loads the default local-library view from the dedicated library API', async () => {
    const { fixture, libraryService, navigateSpy } = await renderPage();
    const resetButton = fixture.nativeElement.querySelector(
      '.reset-filters-button',
    ) as HTMLButtonElement | null;

    expect(libraryService.getScenesFeed).toHaveBeenCalledWith(1, 24, {
      query: undefined,
      sort: 'RELEASE_DATE',
      direction: 'DESC',
      tagIds: [],
      tagMode: 'OR',
      studioIds: [],
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(resetButton?.disabled).toBe(true);
  });

  it('clears active local-library filters back to the default indexed library view', async () => {
    const { fixture, libraryService, navigateSpy } = await renderPage({
      query: 'archive',
      sort: 'TITLE',
      dir: 'ASC',
      mode: 'AND',
      tags: 'tag-1,tag-2',
      tagNames: 'Tag One,Tag Two',
      studios: 'studio-1,studio-2',
      studioNames: 'Archive,North Block',
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

    expect(libraryService.getScenesFeed).toHaveBeenLastCalledWith(1, 24, {
      query: undefined,
      sort: 'RELEASE_DATE',
      direction: 'DESC',
      tagIds: [],
      tagMode: 'OR',
      studioIds: [],
    });
    expect(navigateSpy).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: {
        query: null,
        sort: null,
        dir: null,
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
