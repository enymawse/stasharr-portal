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
