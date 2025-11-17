/**
 * IndexResolver
 * Determines which logical memory index to target based on arguments + defaults.
 */
export class IndexResolver {
  private defaultIndex: string;

  constructor(defaultIndex?: string) {
    this.defaultIndex = defaultIndex || process.env.MEMORY_DEFAULT_INDEX || 'memory';
  }

  /**
   * Resolve the index name to use
   * @param requestedIndex Optional index from tool arguments
   * @returns The resolved index name
   */
  resolve(requestedIndex?: string): string {
    if (requestedIndex !== undefined && requestedIndex !== null) {
      const normalizedIndex = requestedIndex.trim();
      this.validateIndexName(normalizedIndex);
      return normalizedIndex;
    }
    return this.defaultIndex;
  }

  /**
   * Validate that an index name is safe and follows conventions
   */
  private validateIndexName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new Error('Index name must be a non-empty string');
    }

    // Only allow alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid index name "${name}". Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }

    // Reasonable length limit
    if (name.length > 64) {
      throw new Error('Index name must be 64 characters or less');
    }
  }

  /**
   * Get the default index name
   */
  getDefault(): string {
    return this.defaultIndex;
  }
}
