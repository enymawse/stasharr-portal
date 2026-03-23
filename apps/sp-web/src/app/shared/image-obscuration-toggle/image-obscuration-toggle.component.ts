import { Component, computed, inject } from '@angular/core';
import { ImageObscurationService } from '../../core/preferences/image-obscuration.service';

@Component({
  selector: 'app-image-obscuration-toggle',
  templateUrl: './image-obscuration-toggle.component.html',
  styleUrl: './image-obscuration-toggle.component.scss',
})
export class ImageObscurationToggleComponent {
  private readonly imageObscurationService = inject(ImageObscurationService);

  protected readonly isObscured = this.imageObscurationService.isObscured;

  protected readonly label = computed(() =>
    this.isObscured() ? 'Show images' : 'Obscure images',
  );

  protected toggle(): void {
    this.imageObscurationService.toggle();
  }
}
