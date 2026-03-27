import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppShellLayoutComponent } from './app-shell-layout.component';

describe('AppShellLayoutComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders acquisition in primary navigation and removes requests', async () => {
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
    const acquisitionLink = navLinks.find((link) => link.textContent?.includes('Acquisition'));

    expect(acquisitionLink?.getAttribute('href')).toContain('/acquisition');
    expect(navLinks.some((link) => link.textContent?.includes('Requests'))).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Acquisition');
    expect(fixture.nativeElement.textContent).not.toContain('Requests');
  });
});
