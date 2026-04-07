import { TestBed } from '@angular/core/testing';
import { throwError, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from '../../core/api/health.service';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SettingsOverviewPageComponent } from './settings-overview-page.component';

describe('SettingsOverviewPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows readiness as unavailable instead of healthy when setup status fails to load', async () => {
    const setupService = {
      getStatus: vi.fn().mockReturnValue(throwError(() => new Error('boom'))),
    };
    const setupStatusStore = {
      sync: vi.fn(),
    };
    const healthService = {
      getStatus: vi.fn().mockReturnValue(
        of({
          status: 'ok',
          database: 'ok',
          service: 'sp-api',
          version: '1.2.3',
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsOverviewPageComponent],
      providers: [
        {
          provide: SetupService,
          useValue: setupService,
        },
        {
          provide: SetupStatusStore,
          useValue: setupStatusStore,
        },
        {
          provide: HealthService,
          useValue: healthService,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsOverviewPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const heroCard = fixture.nativeElement.querySelector('.hero-card') as HTMLElement | null;
    const statusPill = fixture.nativeElement.querySelector('.status-pill') as HTMLElement | null;

    expect(text).toContain('Required service status unavailable');
    expect(text).toContain('Required service readiness could not be loaded right now.');
    expect(text).toContain('Failed to load the latest integration readiness summary.');
    expect(text).toContain('Unavailable');
    expect(text).not.toContain('Healthy');
    expect(heroCard?.classList.contains('tone-warn')).toBe(true);
    expect(statusPill?.classList.contains('tone-warn')).toBe(true);
  });
});
