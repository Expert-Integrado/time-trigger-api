import { validateEnv } from './main.js';

describe('validateEnv', () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env = {
      ...originalEnv,
      MONGODB_URI: 'mongodb://localhost:27017',
      CRON_INTERVAL_RUNS: '30000',
      CRON_INTERVAL_FUP: '15000',
      CRON_INTERVAL_MESSAGES: '5000',
      TZ: 'America/Sao_Paulo',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('does not exit when all required vars are set', () => {
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits with code 1 when MONGODB_URI is missing', () => {
    delete process.env['MONGODB_URI'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('(CRON-08) exits with code 1 when CRON_INTERVAL_RUNS is missing', () => {
    delete process.env['CRON_INTERVAL_RUNS'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('(CRON-08) exits with code 1 when CRON_INTERVAL_FUP is missing', () => {
    delete process.env['CRON_INTERVAL_FUP'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('(CRON-08) exits with code 1 when CRON_INTERVAL_MESSAGES is missing', () => {
    delete process.env['CRON_INTERVAL_MESSAGES'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('(CRON-09) does NOT exit when old CRON_INTERVAL is absent (removed)', () => {
    // CRON_INTERVAL is no longer required — its absence must not cause exit
    delete process.env['CRON_INTERVAL'];
    validateEnv();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits with code 1 when TZ is missing', () => {
    delete process.env['TZ'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when multiple vars are missing', () => {
    delete process.env['MONGODB_URI'];
    delete process.env['CRON_INTERVAL_RUNS'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs each missing variable name in the error message', () => {
    delete process.env['CRON_INTERVAL_FUP'];
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CRON_INTERVAL_FUP'),
    );
  });
});
