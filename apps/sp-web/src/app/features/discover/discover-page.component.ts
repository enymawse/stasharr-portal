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
  protected readonly items = signal<DiscoverItem[]>([]);

  ngOnInit(): void {
    this.loadDiscoverFeed();
  }

  protected hasItems(): boolean {
    return this.items().length > 0;
  }

  protected displayDate(item: DiscoverItem): string | null {
    return item.releaseDate ?? item.productionDate;
  }

  protected formattedDuration(durationSeconds: number | null): string | null {
    if (!durationSeconds || durationSeconds <= 0) {
      return null;
    }

    const totalMinutes = Math.floor(durationSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
      return `${minutes}m`;
    }

    return `${hours}h ${minutes}m`;
  }

  protected truncatedDetails(details: string | null): string | null {
    if (!details) {
      return null;
    }

    const singleLine = details.replaceAll(/\s+/g, ' ').trim();
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
        next: (items) => {
          this.items.set(items);
        },
        error: () => {
          this.error.set('Failed to load discover feed from the API.');
        },
      });
  }
}
