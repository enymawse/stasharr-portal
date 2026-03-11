import { Component, OnInit, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { DiscoverItem } from '../../core/api/discover.types';

@Component({
  selector: 'app-discover-page',
  templateUrl: './discover-page.component.html',
  styleUrl: './discover-page.component.scss',
})
export class DiscoverPageComponent implements OnInit {
  private readonly discoverService = inject(DiscoverService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly total = signal(0);
  protected readonly items = signal<DiscoverItem[]>([]);

  ngOnInit(): void {
    this.loadDiscoverFeed();
  }

  protected hasItems(): boolean {
    return this.items().length > 0;
  }

  protected formattedDuration(durationSeconds: number | null): string | null {
    if (!durationSeconds || durationSeconds <= 0) {
      return null;
    }

    const minutes = Math.floor(durationSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(durationSeconds % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  protected truncatedDescription(description: string | null): string | null {
    if (!description) {
      return null;
    }

    const singleLine = description.replaceAll(/\s+/g, ' ').trim();
    if (singleLine.length <= 180) {
      return singleLine;
    }

    return `${singleLine.slice(0, 177)}...`;
  }

  private loadDiscoverFeed(): void {
    this.loading.set(true);
    this.error.set(null);

    this.discoverService
      .getDiscoverFeed()
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: (response) => {
          this.total.set(response.total);
          this.items.set(response.items);
        },
        error: () => {
          this.error.set('Failed to load discover feed from the API.');
        },
      });
  }
}
