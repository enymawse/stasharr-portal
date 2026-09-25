import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneDetails } from '../../core/api/discover.types';
import { FeedStateCache } from '../../core/navigation/feed-state-memory';
import { ScenePageComponent } from './scene-page.component';

function buildScene(overrides: Partial<SceneDetails> = {}): SceneDetails {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    images: [],
    studioId: 'studio-1',
    studioIsFavorite: false,
    studio: 'Studio',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    studioUrl: 'http://studio.local',
    releaseDate: '2026-03-01',
    duration: 600,
    tags: [],
    performers: [],
    sourceUrls: [],
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    stash: null,
    whisparr: null,
    ...overrides,
  };
}

describe('ScenePageComponent', () => {
  async function renderScene(scene: SceneDetails) {
    const discoverService = {
      getSceneDetails: vi.fn().mockReturnValue(of(scene)),
    };
    const activatedRoute = {
      paramMap: of(convertToParamMap({ stashId: scene.id })),
      queryParamMap: of(convertToParamMap({})),
      snapshot: {
        paramMap: convertToParamMap({ stashId: scene.id }),
      },
    };

    await TestBed.configureTestingModule({
      imports: [ScenePageComponent],
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

    const fixture = TestBed.createComponent(ScenePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows failed guidance, keeps the Whisparr link, and hides the request button for failed scenes', async () => {
    const scene = buildScene({
      status: { state: 'FAILED' },
      whisparr: {
        exists: true,
        viewUrl: 'http://whisparr.local/movie/scene-1',
      },
    });

    const { fixture, discoverService } = await renderScene(scene);
    const text = fixture.nativeElement.textContent;

    expect(discoverService.getSceneDetails).toHaveBeenCalledWith('scene-1');
    expect(text).toContain('Resolve or retry this download in Whisparr.');
    expect(text).not.toContain('Retry in Whisparr');
    expect(fixture.nativeElement.querySelector('.request-button')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href="http://whisparr.local/movie/scene-1"]')
        ?.textContent,
    ).toContain('View in Whisparr');
  });

  it('marks the requested scene as requested in remembered list pages', async () => {
    const { fixture } = await renderScene(buildScene());
    const cache = TestBed.inject(FeedStateCache);
    cache.save('/scenes', {
      state: {
        items: [
          { id: 'scene-1', status: { state: 'NOT_REQUESTED' }, requestable: true },
          { id: 'scene-2', status: { state: 'NOT_REQUESTED' }, requestable: true },
        ],
        page: 1,
        total: 2,
        hasMore: false,
      },
      scrollPosition: [0, 500],
    });
    cache.save('/studio/studio-1', {
      state: {
        items: [{ id: 'scene-1', status: { state: 'NOT_REQUESTED' } }],
        page: 1,
        total: 1,
        hasMore: false,
      },
      scrollPosition: [0, 900],
    });
    cache.save('/acquisition', {
      state: {
        items: [{ id: 'scene-1', status: { state: 'DOWNLOADING' } }],
        page: 1,
        total: 1,
        hasMore: false,
      },
      scrollPosition: [0, 0],
    });

    (fixture.componentInstance as any).onRequestSubmitted('scene-1');

    expect(cache.get('/scenes')?.state.items).toEqual([
      { id: 'scene-1', status: { state: 'REQUESTED' }, requestable: false },
      { id: 'scene-2', status: { state: 'NOT_REQUESTED' }, requestable: true },
    ]);
    expect(cache.get('/studio/studio-1')?.state.items).toEqual([
      { id: 'scene-1', status: { state: 'REQUESTED' } },
    ]);
    expect(cache.get('/acquisition')?.state.items).toEqual([
      { id: 'scene-1', status: { state: 'DOWNLOADING' } },
    ]);
  });

  it('keeps the normal request CTA for NOT_REQUESTED scenes', async () => {
    const { fixture } = await renderScene(buildScene());

    expect(fixture.nativeElement.textContent).toContain('Request in Whisparr');
  });
});
