export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  slowQueryThresholdMs: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLogLevel(value: string | undefined, defaultLevel: LogLevel): LogLevel {
  if (!value) {
    return defaultLevel;
  }

  const normalized = value.trim().toLowerCase() as LogLevel;
  if (normalized in LOG_LEVELS) {
    return normalized;
  }

  return defaultLevel;
}

function parseLogFormat(value: string | undefined, defaultFormat: LogFormat): LogFormat {
  if (!value) {
    return defaultFormat;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'json' || normalized === 'pretty') {
    return normalized;
  }

  return defaultFormat;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadLoggingConfig(): LoggingConfig {
  return {
    level: parseLogLevel(process.env.MEMORY_LOG_LEVEL, 'info'),
    format: parseLogFormat(process.env.MEMORY_LOG_FORMAT, 'pretty'),
    slowQueryThresholdMs: parseNumber(process.env.MEMORY_DB_SLOW_QUERY_MS, 200),
  };
}

export function shouldLog(configuredLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[configuredLevel];
}
