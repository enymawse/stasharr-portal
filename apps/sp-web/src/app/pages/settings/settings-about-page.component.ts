import { Component, OnInit, inject, signal } from '@angular/core';
import { of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { HealthService } from '../../core/api/health.service';
import { HealthStatusResponse } from '../../core/api/health.types';

@Component({
  selector: 'app-settings-about-page',
  imports: [Message, ProgressSpinner],
  templateUrl: './settings-about-page.component.html',
  styleUrl: './settings-about-page.component.scss',
})
export class SettingsAboutPageComponent implements OnInit {
  private readonly healthService = inject(HealthService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly health = signal<HealthStatusResponse | null>(null);
  protected readonly githubUrl = 'https://github.com/enymawse/stasharr-portal';
  protected readonly docsUrl = 'https://github.com/enymawse/stasharr-portal#self-hosted-quick-start';
  protected readonly releasesUrl = 'https://github.com/enymawse/stasharr-portal/releases';

  ngOnInit(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.healthService
      .getStatus()
      .pipe(
        catchError(() => of(null)),
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe((health) => {
        if (!health) {
          this.loadError.set('Runtime metadata is unavailable right now.');
          return;
        }

        this.health.set(health);
      });
  }
}
