import { Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { ToggleSwitch } from 'primeng/toggleswitch';

@Component({
  selector: 'app-integration-form-fields',
  imports: [ReactiveFormsModule, InputText, Message, ToggleSwitch],
  templateUrl: './integration-form-fields.component.html',
  styleUrl: './integration-form-fields.component.scss',
})
export class IntegrationFormFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() hasStoredApiKey = false;
  @Input() enabledInputId = 'integration-enabled';
}
