import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonDirective } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { AuthService } from '../../core/api/auth.service';

@Component({
  selector: 'app-bootstrap-page',
  imports: [ReactiveFormsModule, ButtonDirective, InputText, Message],
  templateUrl: './bootstrap-page.component.html',
  styleUrl: './bootstrap-page.component.scss',
})
export class BootstrapPageComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly handoffMessage = signal<string | null>(null);

  protected readonly form = new FormGroup({
    username: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(64)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(12), Validators.maxLength(128)],
    }),
    confirmPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected submit(): void {
    this.errorMessage.set(null);
    this.handoffMessage.set(null);

    if (this.form.invalid || this.passwordMismatch()) {
      this.form.markAllAsTouched();
      return;
    }

    const { username, password } = this.form.getRawValue();
    this.submitting.set(true);

    this.authService.bootstrap({ username, password }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.handoffMessage.set('Admin account created. Opening required integration setup next.');
        void this.router.navigate(['/setup'], {
          queryParams: {
            from: 'bootstrap',
          },
        });
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.errorMessage.set(describeBootstrapError(error));
      },
    });
  }

  protected passwordMismatch(): boolean {
    return (
      this.form.controls.confirmPassword.value.length > 0 &&
      this.form.controls.password.value !== this.form.controls.confirmPassword.value
    );
  }
}

function describeBootstrapError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 409) {
      return 'Bootstrap is already complete. Sign in with the existing admin account.';
    }

    return readApiMessage(error) ?? 'Failed to create the admin account.';
  }

  return 'Failed to create the admin account.';
}

function readApiMessage(error: HttpErrorResponse): string | null {
  const message = error.error?.message;
  if (Array.isArray(message) && message.length > 0) {
    return message[0] ?? null;
  }

  return typeof message === 'string' ? message : null;
}
