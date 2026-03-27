import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScenesQueryDto } from './scenes-query.dto';

describe('ScenesQueryDto', () => {
  it('accepts lifecycle values from the shared scene status model', async () => {
    const instance = plainToInstance(ScenesQueryDto, {
      lifecycle: 'IMPORT_PENDING',
    });

    await expect(validate(instance)).resolves.toHaveLength(0);
  });

  it('rejects unknown lifecycle values', async () => {
    const instance = plainToInstance(ScenesQueryDto, {
      lifecycle: 'QUEUED',
    });

    const errors = await validate(instance);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isIn');
  });
});
