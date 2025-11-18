import {
  MemoryMetadata,
  MemoryType,
  Importance,
  RelationshipType,
  MemoryDynamics,
  Relationship,
  EmotionInfo,
} from '../memory/types.js';

/**
 * Validates metadata against schema constraints.
 * Ensures enum fields have valid values and catches schema violations early.
 */
export class MetadataValidator {
  private static readonly VALID_MEMORY_TYPES: MemoryType[] = [
    'self',
    'belief',
    'pattern',
    'episodic',
    'semantic',
  ];

  private static readonly VALID_IMPORTANCE_LEVELS: Importance[] = ['low', 'medium', 'high'];

  private static readonly VALID_STABILITY_VALUES = ['tentative', 'stable', 'canonical'];

  private static readonly VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
    'summarizes',
    'example_of',
    'is_generalization_of',
    'supports',
    'contradicts',
    'causes',
    'similar_to',
    'historical_version_of',
    'derived_from',
  ];

  private static readonly VALID_SOURCES = ['user', 'file', 'system'];
  private static readonly VALID_KINDS = ['raw', 'summary', 'derived'];

  /**
   * Validate metadata object against schema constraints.
   * Throws ValidationError if any constraint is violated.
   *
   * @param metadata Metadata object to validate
   * @throws ValidationError if validation fails
   */
  static validate(metadata: Partial<MemoryMetadata>): void {
    // Validate memoryType if present
    if (metadata.memoryType !== undefined) {
      if (!this.VALID_MEMORY_TYPES.includes(metadata.memoryType)) {
        throw new ValidationError(
          `Invalid memoryType: "${metadata.memoryType}". Must be one of: ${this.VALID_MEMORY_TYPES.join(', ')}`
        );
      }
    }

    // Validate importance if present
    if (metadata.importance !== undefined) {
      if (!this.VALID_IMPORTANCE_LEVELS.includes(metadata.importance)) {
        throw new ValidationError(
          `Invalid importance: "${metadata.importance}". Must be one of: ${this.VALID_IMPORTANCE_LEVELS.join(', ')}`
        );
      }
    }

    // Validate source if present
    if (metadata.source !== undefined) {
      if (!this.VALID_SOURCES.includes(metadata.source)) {
        throw new ValidationError(
          `Invalid source: "${metadata.source}". Must be one of: ${this.VALID_SOURCES.join(', ')}`
        );
      }
    }

    // Validate kind if present
    if (metadata.kind !== undefined) {
      if (!this.VALID_KINDS.includes(metadata.kind)) {
        throw new ValidationError(
          `Invalid kind: "${metadata.kind}". Must be one of: ${this.VALID_KINDS.join(', ')}`
        );
      }
    }

    // Validate dynamics if present
    if (metadata.dynamics !== undefined) {
      this.validateDynamics(metadata.dynamics);
    }

    // Validate relationships if present
    if (metadata.relationships !== undefined) {
      this.validateRelationships(metadata.relationships);
    }

    // Validate emotion if present
    if (metadata.emotion !== undefined) {
      this.validateEmotion(metadata.emotion);
    }

    // Validate tags if present
    if (metadata.tags !== undefined) {
      if (!Array.isArray(metadata.tags)) {
        throw new ValidationError('tags must be an array');
      }
      if (!metadata.tags.every((tag) => typeof tag === 'string')) {
        throw new ValidationError('all tags must be strings');
      }
    }

    // Validate date format if present
    if (metadata.date !== undefined) {
      if (!this.isValidDateFormat(metadata.date)) {
        throw new ValidationError('date must be in YYYY-MM-DD format');
      }
    }

    // Validate relatedIds if present
    if (metadata.relatedIds !== undefined) {
      if (!Array.isArray(metadata.relatedIds)) {
        throw new ValidationError('relatedIds must be an array');
      }
      if (!metadata.relatedIds.every((id) => typeof id === 'string')) {
        throw new ValidationError('all relatedIds must be strings');
      }
    }

    // Validate derivedFromIds if present
    if (metadata.derivedFromIds !== undefined) {
      if (!Array.isArray(metadata.derivedFromIds)) {
        throw new ValidationError('derivedFromIds must be an array');
      }
      if (!metadata.derivedFromIds.every((id) => typeof id === 'string')) {
        throw new ValidationError('all derivedFromIds must be strings');
      }
    }

    // Validate emotion intensity if emotion is present
    if (metadata.emotion?.intensity !== undefined) {
      const intensity = metadata.emotion.intensity;
      if (typeof intensity !== 'number' || intensity < 0 || intensity > 1) {
        throw new ValidationError('emotion.intensity must be a number between 0.0 and 1.0');
      }
    }
  }

  /**
   * Validate dynamics object
   */
  private static validateDynamics(dynamics: unknown): void {
    if (typeof dynamics !== 'object' || dynamics === null) {
      throw new ValidationError('dynamics must be an object');
    }
    const candidate = dynamics as Partial<MemoryDynamics>;

    // Validate stability if present
    if (candidate.stability !== undefined) {
      if (!this.VALID_STABILITY_VALUES.includes(candidate.stability)) {
        throw new ValidationError(
          `Invalid dynamics.stability: "${candidate.stability}". Must be one of: ${this.VALID_STABILITY_VALUES.join(', ')}`
        );
      }
    }

    // Validate priority values if present
    if (candidate.initialPriority !== undefined) {
      if (
        typeof candidate.initialPriority !== 'number' ||
        candidate.initialPriority < 0 ||
        candidate.initialPriority > 1
      ) {
        throw new ValidationError('dynamics.initialPriority must be a number between 0.0 and 1.0');
      }
    }

    if (candidate.currentPriority !== undefined) {
      if (
        typeof candidate.currentPriority !== 'number' ||
        candidate.currentPriority < 0 ||
        candidate.currentPriority > 1
      ) {
        throw new ValidationError('dynamics.currentPriority must be a number between 0.0 and 1.0');
      }
    }

    // Validate accessCount if present
    if (candidate.accessCount !== undefined) {
      if (
        typeof candidate.accessCount !== 'number' ||
        candidate.accessCount < 0 ||
        !Number.isInteger(candidate.accessCount)
      ) {
        throw new ValidationError('dynamics.accessCount must be a non-negative integer');
      }
    }

    // Validate timestamps if present
    if (candidate.createdAt !== undefined && !this.isValidISO8601(candidate.createdAt)) {
      throw new ValidationError('dynamics.createdAt must be a valid ISO 8601 timestamp');
    }

    if (candidate.lastAccessedAt !== undefined && !this.isValidISO8601(candidate.lastAccessedAt)) {
      throw new ValidationError('dynamics.lastAccessedAt must be a valid ISO 8601 timestamp');
    }
  }

  /**
   * Validate relationships array
   */
  private static validateRelationships(relationships: unknown): void {
    if (!Array.isArray(relationships)) {
      throw new ValidationError('relationships must be an array');
    }

    relationships.forEach((rel, index) => {
      if (typeof rel !== 'object' || rel === null) {
        throw new ValidationError(`relationships[${index}] must be an object`);
      }

      const relationship = rel as Partial<Relationship>;

      if (typeof relationship.targetId !== 'string') {
        throw new ValidationError(`relationships[${index}].targetId must be a string`);
      }

      if (!this.VALID_RELATIONSHIP_TYPES.includes(relationship.type as RelationshipType)) {
        throw new ValidationError(
          `relationships[${index}].type must be one of: ${this.VALID_RELATIONSHIP_TYPES.join(', ')}`
        );
      }

      if (relationship.weight !== undefined) {
        if (
          typeof relationship.weight !== 'number' ||
          relationship.weight < 0 ||
          relationship.weight > 1
        ) {
          throw new ValidationError(
            `relationships[${index}].weight must be a number between 0.0 and 1.0`
          );
        }
      }
    });
  }

  /**
   * Validate emotion object
   */
  private static validateEmotion(emotion: unknown): void {
    if (typeof emotion !== 'object' || emotion === null) {
      throw new ValidationError('emotion must be an object');
    }

    const candidate = emotion as Partial<EmotionInfo>;

    if (candidate.label !== undefined && typeof candidate.label !== 'string') {
      throw new ValidationError('emotion.label must be a string');
    }
  }

  /**
   * Check if string is valid YYYY-MM-DD format
   */
  private static isValidDateFormat(date: string): boolean {
    if (typeof date !== 'string') {
      return false;
    }
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(date)) {
      return false;
    }
    // Extract parts and validate they represent a real date
    const [year, month, day] = date.split('-').map(Number);
    // Create date and verify it doesn't overflow (JS normalizes 2024-02-31 to 2024-03-02)
    const d = new Date(year, month - 1, day);
    return (
      d instanceof Date &&
      !isNaN(d.getTime()) &&
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    );
  }

  /**
   * Check if string is valid ISO 8601 timestamp
   */
  private static isValidISO8601(timestamp: string): boolean {
    if (typeof timestamp !== 'string') {
      return false;
    }
    const d = new Date(timestamp);
    // Accept any valid ISO 8601 timestamp that parses correctly, not just toISOString() format
    return d instanceof Date && !isNaN(d.getTime());
  }
}

/**
 * Custom error for metadata validation failures
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
