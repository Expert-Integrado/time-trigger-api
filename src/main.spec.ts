import { validateEnv } from './main.js';

describe('validateEnv', () => {
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env = {
      ...originalEnv,
      MONGODB_URI: 'mongodb://localhost:27017',
      CRON_INTERVAL: '10000',
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

  it('exits with code 1 when CRON_INTERVAL is missing', () => {
    delete process.env['CRON_INTERVAL'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when TZ is missing', () => {
    delete process.env['TZ'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when multiple vars are missing', () => {
    delete process.env['MONGODB_URI'];
    delete process.env['CRON_INTERVAL'];
    validateEnv();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs each missing variable name in the error message', () => {
    delete process.env['MONGODB_URI'];
    validateEnv();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('MONGODB_URI'),
    );
  });
});
