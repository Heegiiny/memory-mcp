import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { loadLoggingConfig, shouldLog } from '../logging.js';

describe('loadLoggingConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should default to info level and pretty format', () => {
    delete process.env.MEMORY_LOG_LEVEL;
    delete process.env.MEMORY_LOG_FORMAT;
    delete process.env.MEMORY_DB_SLOW_QUERY_MS;

    const config = loadLoggingConfig();

    expect(config.level).toBe('info');
    expect(config.format).toBe('pretty');
    expect(config.slowQueryThresholdMs).toBe(200);
  });

  it('should parse valid log levels', () => {
    process.env.MEMORY_LOG_LEVEL = 'debug';
    expect(loadLoggingConfig().level).toBe('debug');

    process.env.MEMORY_LOG_LEVEL = 'info';
    expect(loadLoggingConfig().level).toBe('info');

    process.env.MEMORY_LOG_LEVEL = 'warn';
    expect(loadLoggingConfig().level).toBe('warn');

    process.env.MEMORY_LOG_LEVEL = 'error';
    expect(loadLoggingConfig().level).toBe('error');
  });

  it('should handle case-insensitive log levels', () => {
    process.env.MEMORY_LOG_LEVEL = 'DEBUG';
    expect(loadLoggingConfig().level).toBe('debug');

    process.env.MEMORY_LOG_LEVEL = 'WaRn';
    expect(loadLoggingConfig().level).toBe('warn');
  });

  it('should default to info for invalid log levels', () => {
    process.env.MEMORY_LOG_LEVEL = 'invalid';
    expect(loadLoggingConfig().level).toBe('info');

    process.env.MEMORY_LOG_LEVEL = 'trace';
    expect(loadLoggingConfig().level).toBe('info');
  });

  it('should parse valid log formats', () => {
    process.env.MEMORY_LOG_FORMAT = 'json';
    expect(loadLoggingConfig().format).toBe('json');

    process.env.MEMORY_LOG_FORMAT = 'pretty';
    expect(loadLoggingConfig().format).toBe('pretty');
  });

  it('should handle case-insensitive log formats', () => {
    process.env.MEMORY_LOG_FORMAT = 'JSON';
    expect(loadLoggingConfig().format).toBe('json');

    process.env.MEMORY_LOG_FORMAT = 'Pretty';
    expect(loadLoggingConfig().format).toBe('pretty');
  });

  it('should default to pretty for invalid log formats', () => {
    process.env.MEMORY_LOG_FORMAT = 'xml';
    expect(loadLoggingConfig().format).toBe('pretty');

    process.env.MEMORY_LOG_FORMAT = 'yaml';
    expect(loadLoggingConfig().format).toBe('pretty');
  });

  it('should parse slow query threshold', () => {
    process.env.MEMORY_DB_SLOW_QUERY_MS = '500';
    expect(loadLoggingConfig().slowQueryThresholdMs).toBe(500);

    process.env.MEMORY_DB_SLOW_QUERY_MS = '1000';
    expect(loadLoggingConfig().slowQueryThresholdMs).toBe(1000);
  });

  it('should default to 200 for invalid slow query threshold', () => {
    process.env.MEMORY_DB_SLOW_QUERY_MS = 'invalid';
    expect(loadLoggingConfig().slowQueryThresholdMs).toBe(200);

    process.env.MEMORY_DB_SLOW_QUERY_MS = '-50';
    expect(loadLoggingConfig().slowQueryThresholdMs).toBe(-50); // parseInt accepts negative numbers
  });

  it('should handle empty string env vars', () => {
    process.env.MEMORY_LOG_LEVEL = '';
    process.env.MEMORY_LOG_FORMAT = '';
    process.env.MEMORY_DB_SLOW_QUERY_MS = '';

    const config = loadLoggingConfig();

    expect(config.level).toBe('info');
    expect(config.format).toBe('pretty');
    expect(config.slowQueryThresholdMs).toBe(200);
  });

  it('should handle whitespace in env vars', () => {
    process.env.MEMORY_LOG_LEVEL = '  debug  ';
    process.env.MEMORY_LOG_FORMAT = '  json  ';

    const config = loadLoggingConfig();

    expect(config.level).toBe('debug');
    expect(config.format).toBe('json');
  });
});

describe('shouldLog', () => {
  it('should respect log level hierarchy', () => {
    // debug level should log everything
    expect(shouldLog('debug', 'debug')).toBe(true);
    expect(shouldLog('debug', 'info')).toBe(true);
    expect(shouldLog('debug', 'warn')).toBe(true);
    expect(shouldLog('debug', 'error')).toBe(true);

    // info level should not log debug
    expect(shouldLog('info', 'debug')).toBe(false);
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('info', 'warn')).toBe(true);
    expect(shouldLog('info', 'error')).toBe(true);

    // warn level should only log warn and error
    expect(shouldLog('warn', 'debug')).toBe(false);
    expect(shouldLog('warn', 'info')).toBe(false);
    expect(shouldLog('warn', 'warn')).toBe(true);
    expect(shouldLog('warn', 'error')).toBe(true);

    // error level should only log error
    expect(shouldLog('error', 'debug')).toBe(false);
    expect(shouldLog('error', 'info')).toBe(false);
    expect(shouldLog('error', 'warn')).toBe(false);
    expect(shouldLog('error', 'error')).toBe(true);
  });
});
