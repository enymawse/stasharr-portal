import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import {
  ReadinessState,
  integrationReadinessLabel,
} from '../../core/api/integrations.types';
import { IntegrationFormFieldsComponent } from '../integration-form-fields/integration-form-fields.component';

export interface IntegrationRepairPanelMessage {
  severity: 'success' | 'error' | 'warn' | 'info';
  text: string;
}

@Component({
  selector: 'app-integration-repair-panel',
  imports: [ReactiveFormsModule, ButtonDirective, Message, IntegrationFormFieldsComponent],
  templateUrl: './integration-repair-panel.component.html',
  styleUrl: './integration-repair-panel.component.scss',
})
export class IntegrationRepairPanelComponent {
  @Input({ required: true }) label!: string;
  @Input() sectionLabel = '';
  @Input({ required: true }) state!: ReadinessState;
  @Input({ required: true }) summary!: string;
  @Input() helpText: string | null = null;
  @Input({ required: true }) form!: FormGroup;
  @Input() hasStoredApiKey = false;
  @Input() enabledInputId = 'integration-enabled';
  @Input() showEnabledToggle = true;
  @Input() lastHealthyAt: string | null = null;
  @Input() lastErrorAt: string | null = null;
  @Input() errorMessage: string | null = null;
  @Input() primaryActionLabel = 'Save & Test';
  @Input() primaryDisabled = false;
  @Input() secondaryActionLabel = 'Save only';
  @Input() secondaryDisabled = false;
  @Input() actionHint = '';
  @Input() messages: readonly IntegrationRepairPanelMessage[] = [];
  @Input() submitAction: 'primary' | 'secondary' = 'secondary';

  @Output() primaryAction = new EventEmitter<void>();
  @Output() secondaryAction = new EventEmitter<void>();

  protected readinessLabel(): string {
    return integrationReadinessLabel(this.state);
  }

  protected stateClass(): string {
    switch (this.state) {
      case 'READY':
        return 'is-ready';
      case 'TEST_FAILED':
        return 'is-error';
      case 'SAVED':
        return 'is-saved';
      case 'NOT_SAVED':
      default:
        return 'is-pending';
    }
  }

  protected onPrimaryClick(): void {
    if (this.submitAction === 'primary') {
      return;
    }

    this.primaryAction.emit();
  }

  protected onSecondaryClick(): void {
    if (this.submitAction === 'secondary') {
      return;
    }

    this.secondaryAction.emit();
  }

  protected onSubmit(): void {
    if (this.submitAction === 'primary') {
      this.primaryAction.emit();
      return;
    }

    this.secondaryAction.emit();
  }
}
