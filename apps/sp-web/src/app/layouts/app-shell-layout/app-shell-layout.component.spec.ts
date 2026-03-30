import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppShellLayoutComponent } from './app-shell-layout.component';

describe('AppShellLayoutComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the consolidated primary navigation labels', async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellLayoutComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppShellLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const navLinks = Array.from(
      fixture.nativeElement.querySelectorAll('a.nav-item') as NodeListOf<HTMLAnchorElement>,
    );
    const navLabels = navLinks
      .map((link) => link.textContent?.replace(/\s+/g, ' ').trim())
      .filter((label): label is string => Boolean(label));

    expect(navLabels).toEqual([
      'Home',
      'Scenes',
      'Acquisition',
      'Library',
      'Performers',
      'Studios',
      'Settings',
    ]);
    expect(navLinks.find((link) => link.textContent?.includes('Scenes'))?.getAttribute('href')).toContain(
      '/scenes',
    );
  });
});
