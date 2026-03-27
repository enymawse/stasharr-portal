import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AcquisitionService } from '../../core/api/acquisition.service';
import { AcquisitionSceneItem, AcquisitionScenesResponse } from '../../core/api/acquisition.types';
import { AcquisitionPageComponent } from './acquisition-page.component';

function buildItem(overrides: Partial<AcquisitionSceneItem> = {}): AcquisitionSceneItem {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    cardImageUrl: 'http://cdn.local/card.jpg',
    studioId: 'studio-1',
    studio: 'Studio',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-01',
    duration: 720,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'FAILED' },
    whisparrViewUrl: 'http://whisparr.local/movie/scene-1',
    ...overrides,
  };
}

function buildResponse(
  items: AcquisitionSceneItem[],
  overrides: Partial<AcquisitionScenesResponse> = {},
): AcquisitionScenesResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 50,
    hasMore: false,
    countsByLifecycle: {
      REQUESTED: items.filter((item) => item.status.state === 'REQUESTED').length,
      DOWNLOADING: items.filter((item) => item.status.state === 'DOWNLOADING').length,
      IMPORT_PENDING: items.filter((item) => item.status.state === 'IMPORT_PENDING').length,
      FAILED: items.filter((item) => item.status.state === 'FAILED').length,
    },
    items,
    ...overrides,
  };
}

describe('AcquisitionPageComponent', () => {
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

  async function renderPage() {
    const allResponse = buildResponse([
      buildItem({
        id: 'scene-failed',
        title: 'Failed Scene',
        status: { state: 'FAILED' },
        whisparrViewUrl: 'http://whisparr.local/movie/failed',
      }),
      buildItem({
        id: 'scene-downloading',
        title: 'Downloading Scene',
        status: { state: 'DOWNLOADING' },
        whisparrViewUrl: 'http://whisparr.local/movie/downloading',
      }),
    ]);
    const failedResponse = buildResponse([
      buildItem({
        id: 'scene-failed',
        title: 'Failed Scene',
        status: { state: 'FAILED' },
        whisparrViewUrl: 'http://whisparr.local/movie/failed',
      }),
    ]);

    const acquisitionService = {
      getScenesFeed: vi.fn((page: number, perPage: number, lifecycle = 'ANY') =>
        of(lifecycle === 'FAILED' ? failedResponse : allResponse),
      ),
    };
    const activatedRoute = {
      queryParamMap: of(convertToParamMap({})),
      snapshot: {
        queryParamMap: convertToParamMap({}),
      },
    };

    await TestBed.configureTestingModule({
      imports: [AcquisitionPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AcquisitionService,
          useValue: acquisitionService,
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(AcquisitionPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, acquisitionService };
  }

  it('renders the acquisition feed, omits request CTA buttons, and keeps failed Whisparr guidance honest', async () => {
    const { fixture, acquisitionService } = await renderPage();
    const text = fixture.nativeElement.textContent;

    expect(acquisitionService.getScenesFeed).toHaveBeenCalledWith(1, 50, 'ANY');
    expect(text).toContain('Acquisition');
    expect(text).toContain('Resolve or retry this download in Whisparr.');
    expect(fixture.nativeElement.querySelector('.request-cta')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href="http://whisparr.local/movie/failed"]')
        ?.textContent,
    ).toContain('View in Whisparr');
  });

  it('reloads the feed when the lifecycle filter changes', async () => {
    const { fixture, acquisitionService } = await renderPage();
    const filterButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.filter-pill') as NodeListOf<HTMLButtonElement>,
    );
    const failedFilterButton = filterButtons.find((button) =>
      button.textContent?.includes('Failed'),
    );

    expect(failedFilterButton).toBeTruthy();

    failedFilterButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(acquisitionService.getScenesFeed).toHaveBeenLastCalledWith(1, 50, 'FAILED');
    expect(fixture.nativeElement.textContent).toContain('Failed Scene');
    expect(fixture.nativeElement.textContent).not.toContain('Downloading Scene');
  });
});
