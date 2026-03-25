import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('(OPS-03) is defined', () => {
    expect(controller).toBeDefined();
  });

  it('(OPS-03) check() returns status ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('(OPS-03) check() returns uptime as a non-negative number', () => {
    const result = controller.check();
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});
