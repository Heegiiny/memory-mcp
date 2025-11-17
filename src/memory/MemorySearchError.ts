import { SearchDiagnostics } from './types.js';

/**
 * Custom error class for memory search failures that carries diagnostic information.
 * This allows upstream callers to access detailed context about what went wrong.
 */
export class MemorySearchError extends Error {
  public readonly diagnostics: SearchDiagnostics;
  public readonly cause?: Error;

  constructor(message: string, diagnostics: SearchDiagnostics, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MemorySearchError';
    this.diagnostics = diagnostics;
    this.cause = cause;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MemorySearchError);
    }
  }
}
