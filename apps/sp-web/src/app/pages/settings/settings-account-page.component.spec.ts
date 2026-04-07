import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/api/auth.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SettingsAccountPageComponent } from './settings-account-page.component';

describe('SettingsAccountPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders account security as its own settings subsection', async () => {
    const authService = {
      status: signal({ authenticated: true, bootstrapRequired: false, username: 'admin' }),
      changePassword: vi.fn().mockReturnValue(of(undefined)),
    };
    const notifications = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsAccountPageComponent],
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

    const fixture = TestBed.createComponent(SettingsAccountPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Account security');
    expect(text).toContain('Change admin password');
    expect(text).toContain('admin');
  });
});
