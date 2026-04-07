import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from '../../core/api/health.service';
import { SettingsAboutPageComponent } from './settings-about-page.component';

describe('SettingsAboutPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders real runtime metadata and project links without placeholder content', async () => {
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
      imports: [SettingsAboutPageComponent],
      providers: [
        {
          provide: HealthService,
          useValue: healthService,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsAboutPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.link-list a') as NodeListOf<HTMLAnchorElement>,
    );

    expect(text).toContain('About Stasharr');
    expect(text).toContain('Stasharr');
    expect(text).toContain('1.2.3');
    expect(text).toContain('sp-api');
    expect(text.toLowerCase()).not.toContain('stub');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://github.com/enymawse/stasharr-portal',
      'https://github.com/enymawse/stasharr-portal#self-hosted-quick-start',
      'https://github.com/enymawse/stasharr-portal/releases',
    ]);
    expect(links.some((link) => link.getAttribute('href') === '#')).toBe(false);
  });
});
