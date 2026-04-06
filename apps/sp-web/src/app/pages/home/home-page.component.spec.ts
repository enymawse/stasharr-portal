import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneExplorerItem, ScenesFeedResponse } from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import { HomeRailConfig, HomeRailContentResponse, HomeRailItem } from '../../core/api/home.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { HomePageComponent } from './home-page.component';

function buildDiscoveryItem(overrides: Partial<SceneExplorerItem> = {}): SceneExplorerItem {
  return {
    id: 'stashdb-scene-1',
    title: 'Discovery Scene',
    description: 'Discovered in StashDB.',
    imageUrl: 'http://cdn.local/discovery.jpg',
    cardImageUrl: 'http://cdn.local/discovery-card.jpg',
    studioId: 'studio-1',
    studio: 'Studio One',
    studioImageUrl: 'http://cdn.local/studio-1.jpg',
    releaseDate: '2026-03-28',
    duration: 1800,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    requestable: true,
    ...overrides,
  };
}

function buildDiscoverFeed(
  items: SceneExplorerItem[] = [buildDiscoveryItem()],
): ScenesFeedResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 16,
    hasMore: false,
    items,
  };
}

function buildRailItem(overrides: Partial<HomeRailItem> = {}): HomeRailItem {
  return {
    id: 'local-scene-1',
    title: 'Library Scene',
    description: 'Already in the local library.',
    imageUrl: '/api/media/stash/scenes/local-scene-1/screenshot',
    cardImageUrl: '/api/media/stash/scenes/local-scene-1/screenshot',
    studioId: 'studio-2',
    studio: 'Archive',
    studioImageUrl: '/api/media/stash/studios/studio-2/logo',
    releaseDate: '2026-03-27',
    duration: 1500,
    type: 'SCENE',
    source: 'STASH',
    status: { state: 'AVAILABLE' },
    requestable: false,
    viewUrl: 'http://stash.local/scenes/local-scene-1',
    ...overrides,
  };
}

describe('HomePageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderPage() {
    const rails: HomeRailConfig[] = [
      {
        id: 'rail-stashdb',
        key: null,
        kind: 'CUSTOM',
        source: 'STASHDB',
        contentType: 'SCENES',
        title: 'Discovery Rail',
        subtitle: 'StashDB discovery',
        enabled: true,
        sortOrder: 0,
        editable: true,
        deletable: true,
        config: {
          sort: 'DATE',
          direction: 'DESC',
          favorites: 'ALL',
          tagIds: ['tag-1'],
          tagNames: ['Tag One'],
          tagMode: 'AND',
          studioIds: ['studio-1'],
          studioNames: ['Studio One'],
          limit: 16,
        },
      },
      {
        id: 'rail-stash',
        key: null,
        kind: 'CUSTOM',
        source: 'STASH',
        contentType: 'SCENES',
        title: 'Library Rail',
        subtitle: 'Local Stash browsing',
        enabled: true,
        sortOrder: 1,
        editable: true,
        deletable: true,
        config: {
          sort: 'CREATED_AT',
          direction: 'DESC',
          titleQuery: 'archive',
          tagIds: ['tag-2'],
          tagNames: ['Tag Two'],
          tagMode: 'OR',
          studioIds: ['studio-2'],
          studioNames: ['Archive'],
          favoritePerformersOnly: true,
          favoriteStudiosOnly: true,
          favoriteTagsOnly: true,
          limit: 16,
        },
      },
    ];

    const homeRailItemsById: Record<string, HomeRailContentResponse> = {
      'rail-stash': {
        items: [buildRailItem()],
        message: null,
      },
    };

    const discoverService = {
      getScenesFeed: vi.fn().mockReturnValue(of(buildDiscoverFeed())),
      searchSceneTags: vi.fn().mockReturnValue(of([])),
      searchPerformerStudios: vi.fn().mockReturnValue(of([])),
      getSceneRequestOptions: vi.fn().mockReturnValue(of(null)),
      submitSceneRequest: vi.fn().mockReturnValue(of(null)),
    };
    const homeService = {
      getRails: vi.fn().mockReturnValue(of(rails)),
      getRailItems: vi.fn().mockImplementation((id: string) => of(homeRailItemsById[id])),
      searchStashTags: vi.fn().mockReturnValue(of([])),
      searchStashStudios: vi.fn().mockReturnValue(of([])),
      updateRails: vi.fn(),
      createRail: vi.fn(),
      updateRail: vi.fn(),
      deleteRail: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [HomePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: HomeService,
          useValue: homeService,
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HomePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService };
  }

  function railSectionByTitle(
    fixture: ComponentFixture<HomePageComponent>,
    title: string,
  ): HTMLElement {
    const sections = Array.from(
      fixture.nativeElement.querySelectorAll('.rail-section') as NodeListOf<HTMLElement>,
    );
    const section = sections.find(
      (candidate) =>
        candidate.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim() === title,
    );

    expect(section).toBeTruthy();
    return section as HTMLElement;
  }

  it('routes STASHDB rails to /scenes and STASH rails to /library', async () => {
    const { fixture, discoverService } = await renderPage();

    expect(discoverService.getScenesFeed).toHaveBeenCalledWith(
      1,
      16,
      'DATE',
      'DESC',
      ['tag-1'],
      'AND',
      'ALL',
      ['studio-1'],
    );

    const discoveryLink = railSectionByTitle(fixture, 'Discovery Rail').querySelector(
      '.see-all-link',
    ) as HTMLAnchorElement | null;
    const libraryLink = railSectionByTitle(fixture, 'Library Rail').querySelector(
      '.see-all-link',
    ) as HTMLAnchorElement | null;

    expect(discoveryLink?.getAttribute('href')).toContain('/scenes');
    expect(discoveryLink?.getAttribute('href')).toContain('fav=ALL');
    expect(discoveryLink?.getAttribute('href')).toContain('tags=tag-1');
    expect(discoveryLink?.getAttribute('href')).toContain('studios=studio-1');

    expect(libraryLink?.getAttribute('href')).toContain('/library');
    expect(libraryLink?.getAttribute('href')).toContain('sort=CREATED_AT');
    expect(libraryLink?.getAttribute('href')).toContain('dir=DESC');
    expect(libraryLink?.getAttribute('href')).toContain('query=archive');
    expect(libraryLink?.getAttribute('href')).toContain('favoritePerformersOnly=1');
    expect(libraryLink?.getAttribute('href')).toContain('favoriteStudiosOnly=1');
    expect(libraryLink?.getAttribute('href')).toContain('favoriteTagsOnly=1');
    expect(libraryLink?.getAttribute('href')).toContain('tags=tag-2');
    expect(libraryLink?.getAttribute('href')).toContain('studios=studio-2');
  });

  it('renders Home rails through the shared scene card and preserves request routing', async () => {
    const { fixture } = await renderPage();
    const component = fixture.componentInstance as any;
    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    const discoverySection = railSectionByTitle(fixture, 'Discovery Rail');
    const librarySection = railSectionByTitle(fixture, 'Library Rail');
    const requestButton = discoverySection.querySelector('.request-cta') as HTMLButtonElement | null;
    const libraryLink = librarySection.querySelector('.media-link-stretch') as HTMLAnchorElement | null;

    expect(cards).toHaveLength(2);
    expect(libraryLink?.getAttribute('href')).toBe('http://stash.local/scenes/local-scene-1');
    expect(component.requestModalOpen()).toBe(false);

    requestButton?.click();

    expect(component.requestModalOpen()).toBe(true);
    expect(component.requestContext()).toEqual({
      id: 'stashdb-scene-1',
      title: 'Discovery Scene',
      imageUrl: 'http://cdn.local/discovery.jpg',
    });
  });

  it('limits custom rail creation to Catalog and Stash and removes hybrid-only controls', async () => {
    const { fixture } = await renderPage();
    const component = fixture.componentInstance as any;

    component.openEditor();
    component.openCreateRailForm();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.sourceOptions.map((option: { value: string }) => option.value)).toEqual([
      'STASHDB',
      'STASH',
    ]);
    expect(fixture.nativeElement.textContent).not.toContain('Hybrid');
    expect(fixture.nativeElement.querySelector('#home-rail-hybrid-favorites')).toBeNull();
    expect(fixture.nativeElement.querySelector('#home-rail-library-availability')).toBeNull();

    component.updateRailSource('STASH');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#home-rail-hybrid-favorites')).toBeNull();
    expect(fixture.nativeElement.querySelector('#home-rail-library-availability')).toBeNull();
  });
});
