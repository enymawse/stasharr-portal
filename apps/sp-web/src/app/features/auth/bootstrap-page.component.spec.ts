import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/api/auth.service';
import { BootstrapPageComponent } from './bootstrap-page.component';

describe('BootstrapPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('explains the setup handoff and navigates directly to setup after admin creation', async () => {
    const authService = {
      bootstrap: vi.fn().mockReturnValue(
        of({
          bootstrapRequired: false,
          authenticated: true,
          username: 'admin',
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [BootstrapPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BootstrapPageComponent);
    const component = fixture.componentInstance as any;

    fixture.detectChanges();

    component.form.setValue({
      username: 'admin',
      password: 'long-password-123',
      confirmPassword: 'long-password-123',
    });
    component.submit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(authService.bootstrap).toHaveBeenCalledWith({
      username: 'admin',
      password: 'long-password-123',
    });
    expect(fixture.nativeElement.textContent).toContain(
      'After this, Stasharr opens required integration setup',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Admin account created. Opening required integration setup next.',
    );
    expect(navigate).toHaveBeenCalledWith(['/setup'], {
      queryParams: {
        from: 'bootstrap',
      },
    });
  });
});
