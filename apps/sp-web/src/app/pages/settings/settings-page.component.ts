import { Component } from '@angular/core';

@Component({
  selector: 'app-settings-page',
  template: `
    <main class="stub-page">
      <h1>Settings</h1>
      <p>This is a placeholder for the Settings section.</p>
    </main>
  `,
  styles: `
    .stub-page {
      padding: 1.3rem 1rem;
      color: var(--text-primary);
    }

    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.4rem;
    }

    p {
      margin: 0;
      color: var(--text-muted);
    }
  `,
})
export class SettingsPageComponent {}
