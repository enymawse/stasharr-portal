import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsPageComponent } from './settings-page.component';

describe('SettingsPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders explicit navigation for each settings subsection', async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const navLinks = Array.from(
      fixture.nativeElement.querySelectorAll('.settings-nav-link') as NodeListOf<HTMLAnchorElement>,
    );

    expect(navLinks.map((link) => link.textContent?.trim())).toEqual([
      'Overview',
      'Integrations',
      'Indexing',
      'Account',
      'About',
    ]);
    expect(navLinks[0]?.getAttribute('href')).toContain('/settings');
    expect(navLinks[1]?.getAttribute('href')).toContain('/settings/integrations');
    expect(navLinks[2]?.getAttribute('href')).toContain('/settings/indexing');
    expect(navLinks[3]?.getAttribute('href')).toContain('/settings/account');
    expect(navLinks[4]?.getAttribute('href')).toContain('/settings/about');
  });
});
