import { Component, signal, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StatusResponse, StatusService } from './core/api/status.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly statusService = inject(StatusService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<StatusResponse | null>(null);
  protected readonly title = signal('Stasharr Portal');

  ngOnInit(): void {
    this.statusService.getStatus().subscribe({
      next: (response) => {
        this.status.set(response);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to reach SP API');
        this.loading.set(false);
      },
    });
  }
}
