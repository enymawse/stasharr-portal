import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcquisitionScenesQueryDto } from './acquisition-scenes-query.dto';

describe('AcquisitionScenesQueryDto', () => {
  it('accepts acquisition lifecycle values', async () => {
    const instance = plainToInstance(AcquisitionScenesQueryDto, {
      lifecycle: 'IMPORT_PENDING',
    });

    await expect(validate(instance)).resolves.toHaveLength(0);
  });

  it('rejects lifecycle states outside the acquisition page scope', async () => {
    const instance = plainToInstance(AcquisitionScenesQueryDto, {
      lifecycle: 'AVAILABLE',
    });

    const errors = await validate(instance);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isIn');
  });
});
