import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SetupService } from './core/api/setup.service';
import { ThemeToggleComponent } from './shared/theme-toggle/theme-toggle.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThemeToggleComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly setupService = inject(SetupService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.setupService.getStatus().subscribe({
      next: (status) => {
        const target = status.setupComplete ? '/discover' : '/setup';
        this.navigateTo(target);
      },
      error: () => {
        this.navigateTo('/setup');
      },
    });
  }

  private navigateTo(target: string): void {
    if (this.router.url !== target) {
      void this.router.navigateByUrl(target);
    }
  }
}
