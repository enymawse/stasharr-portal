import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

@Injectable({
  providedIn: 'root',
})
export class AppNotificationsService {
  private readonly messageService = inject(MessageService);
  private static readonly TOAST_KEY = 'global';
  private static readonly DEFAULT_LIFE_MS = 3400;

  success(summary: string, detail?: string): void {
    this.messageService.add({
      key: AppNotificationsService.TOAST_KEY,
      severity: 'success',
      summary,
      detail,
      life: AppNotificationsService.DEFAULT_LIFE_MS,
    });
  }

  error(summary: string, detail?: string): void {
    this.messageService.add({
      key: AppNotificationsService.TOAST_KEY,
      severity: 'error',
      summary,
      detail,
      life: AppNotificationsService.DEFAULT_LIFE_MS + 700,
    });
  }

  info(summary: string, detail?: string): void {
    this.messageService.add({
      key: AppNotificationsService.TOAST_KEY,
      severity: 'info',
      summary,
      detail,
      life: AppNotificationsService.DEFAULT_LIFE_MS,
    });
  }
}
