import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonDirective } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { AuthService } from '../../core/api/auth.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

@Component({
  selector: 'app-account-settings-section',
  imports: [ReactiveFormsModule, ButtonDirective, InputText, Message],
  templateUrl: './account-settings-section.component.html',
  styleUrl: './account-settings-section.component.scss',
})
export class AccountSettingsSectionComponent {
  private readonly authService = inject(AuthService);
  private readonly notifications = inject(AppNotificationsService);

  protected readonly authStatus = this.authService.status;
  protected readonly submitting = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = new FormGroup({
    currentPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12), Validators.maxLength(128)],
    }),
    confirmPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected submit(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);

    if (this.form.invalid || this.passwordMismatch()) {
      this.form.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword } = this.form.getRawValue();
    this.submitting.set(true);

    this.authService.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        const message = 'Password updated. Other sessions were signed out.';
        this.submitting.set(false);
        this.successMessage.set(message);
        this.form.reset({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        this.notifications.success(message);
      },
      error: (error: unknown) => {
        const message = describePasswordChangeError(error);
        this.submitting.set(false);
        this.errorMessage.set(message);
        this.notifications.error(message);
      },
    });
  }

  protected passwordMismatch(): boolean {
    return (
      this.form.controls.confirmPassword.value.length > 0 &&
      this.form.controls.newPassword.value !== this.form.controls.confirmPassword.value
    );
  }
}

function describePasswordChangeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) {
      return readApiMessage(error) ?? 'Current password is incorrect.';
    }

    return readApiMessage(error) ?? 'Failed to update the password.';
  }

  return 'Failed to update the password.';
}

function readApiMessage(error: HttpErrorResponse): string | null {
  const message = error.error?.message;
  if (Array.isArray(message) && message.length > 0) {
    return message[0] ?? null;
  }

  return typeof message === 'string' ? message : null;
}
