import { Pool } from 'pg';
import { debugLog } from '../utils/logger.js';

/**
 * PoolManager
 * Singleton manager for Postgres connection pools
 *
 * Manages one Pool instance per unique database URL to avoid connection leaks
 * and enable efficient connection reuse across repository operations.
 */
class PoolManagerClass {
  private pools: Map<string, Pool> = new Map();
  private isShuttingDown = false;

  /**
   * Get or create a connection pool for the given database URL.
   *
   * Pools are cached by URL to enable connection reuse. Each pool is configured
   * with reasonable defaults for connection limits and timeouts.
   *
   * @param databaseUrl - PostgreSQL connection string
   * @returns Cached or new Pool instance
   */
  getPool(databaseUrl: string): Pool {
    if (this.isShuttingDown) {
      throw new Error('PoolManager is shutting down, cannot create new pools');
    }

    let pool = this.pools.get(databaseUrl);

    if (!pool) {
      debugLog('operation', `Creating new Postgres pool for URL: ${this.maskUrl(databaseUrl)}`);

      pool = new Pool({
        connectionString: databaseUrl,
        max: 10, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 10000, // Fail connection after 10 seconds
        // Enable application_name for query traceability
        application_name: 'memory-mcp',
      });

      // Log pool errors
      pool.on('error', (err: Error) => {
        console.error('Unexpected pool error:', err);
      });

      this.pools.set(databaseUrl, pool);
    }

    return pool;
  }

  /**
   * Close all pools and release connections.
   *
   * Should be called during graceful shutdown to ensure all connections
   * are properly closed.
   */
  async closeAll(): Promise<void> {
    this.isShuttingDown = true;
    debugLog('operation', `Closing ${this.pools.size} Postgres pool(s)`);

    const closePromises = Array.from(this.pools.entries()).map(async ([url, pool]) => {
      try {
        await pool.end();
        debugLog('operation', `Closed pool for URL: ${this.maskUrl(url)}`);
      } catch (error) {
        console.error(`Error closing pool for URL ${this.maskUrl(url)}:`, error);
      }
    });

    await Promise.all(closePromises);
    this.pools.clear();
  }

  /**
   * Close a specific pool by database URL.
   *
   * Useful for cleanup when a project database is removed or changed.
   *
   * @param databaseUrl - PostgreSQL connection string
   */
  async closePool(databaseUrl: string): Promise<void> {
    const pool = this.pools.get(databaseUrl);
    if (pool) {
      try {
        await pool.end();
        this.pools.delete(databaseUrl);
        debugLog('operation', `Closed pool for URL: ${this.maskUrl(databaseUrl)}`);
      } catch (error) {
        console.error(`Error closing pool for URL ${this.maskUrl(databaseUrl)}:`, error);
        throw error;
      }
    }
  }

  /**
   * Get the number of active pools.
   *
   * Useful for testing and diagnostics.
   */
  getPoolCount(): number {
    return this.pools.size;
  }

  /**
   * Mask sensitive parts of database URL for logging.
   *
   * @param url - Database URL to mask
   * @returns Masked URL with credentials hidden
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      if (parsed.username) {
        parsed.username = parsed.username.substring(0, 3) + '***';
      }
      return parsed.toString();
    } catch {
      // If URL parsing fails, just show length
      return `<url-${url.length}-chars>`;
    }
  }
}

// Export singleton instance
export const PoolManager = new PoolManagerClass();

// Register cleanup on process exit
process.on('beforeExit', async () => {
  await PoolManager.closeAll();
});

process.on('SIGINT', async () => {
  await PoolManager.closeAll();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await PoolManager.closeAll();
  process.exit(0);
});
