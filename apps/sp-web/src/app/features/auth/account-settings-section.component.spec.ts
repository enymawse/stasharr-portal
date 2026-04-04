import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/api/auth.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { AccountSettingsSectionComponent } from './account-settings-section.component';

describe('AccountSettingsSectionComponent', () => {
  async function renderComponent() {
    const authStatus = signal({
      bootstrapRequired: false,
      authenticated: true,
      username: 'admin',
    });
    const authService = {
      status: authStatus.asReadonly(),
      changePassword: vi.fn().mockReturnValue(of(void 0)),
    };
    const notifications = {
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AccountSettingsSectionComponent],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: AppNotificationsService,
          useValue: notifications,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AccountSettingsSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance as any,
      authService,
      notifications,
    };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('submits a password change and resets the form on success', async () => {
    const { component, authService, notifications } = await renderComponent();

    component.form.setValue({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
      confirmPassword: 'new-password-456',
    });

    component.submit();

    expect(authService.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    });
    expect(component.successMessage()).toContain('Password updated');
    expect(component.form.getRawValue()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
    expect(notifications.success).toHaveBeenCalledTimes(1);
  });

  it('keeps the request client-side when the new password confirmation does not match', async () => {
    const { component, authService } = await renderComponent();

    component.form.setValue({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
      confirmPassword: 'different-password',
    });

    component.submit();

    expect(component.passwordMismatch()).toBe(true);
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it('shows an inline error when the current password is rejected', async () => {
    const { component, authService, notifications } = await renderComponent();
    authService.changePassword.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: {
              message: 'Current password is incorrect.',
            },
          }),
      ),
    );

    component.form.setValue({
      currentPassword: 'wrong-password',
      newPassword: 'new-password-456',
      confirmPassword: 'new-password-456',
    });

    component.submit();

    expect(component.errorMessage()).toBe('Current password is incorrect.');
    expect(notifications.error).toHaveBeenCalledTimes(1);
  });
});
