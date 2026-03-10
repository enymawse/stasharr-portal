import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { App } from './app';
import { IntegrationsService } from './core/api/integrations.service';
import { SetupService } from './core/api/setup.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: SetupService,
          useValue: {
            getStatus: () =>
              of({
                setupComplete: false,
                required: { stash: false, stashdb: false, whisparr: false },
              }),
          },
        },
        {
          provide: IntegrationsService,
          useValue: {
            getIntegrations: () => of([]),
            updateIntegration: () => of(null),
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Stasharr Portal Setup');
  });
});
