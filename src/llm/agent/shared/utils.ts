/**
 * Convert structured filters to the repository filter expression syntax.
 * E.g., { sourcePath: \"path/to/file\", tags: [\"tag1\"] } => '@metadata.sourcePath = \"path/to/file\" AND @metadata.tags CONTAINS \"tag1\"'
 */
export function convertFiltersToExpression(
  filters: Record<string, string | number | boolean | string[]>
): string {
  const expressions: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;

    const fieldName = `@metadata.${key}`;

    if (typeof value === 'string') {
      expressions.push(`${fieldName} = "${value}"`);
    } else if (typeof value === 'number') {
      expressions.push(`${fieldName} = ${value}`);
    } else if (typeof value === 'boolean') {
      expressions.push(`${fieldName} = ${value}`);
    } else if (Array.isArray(value)) {
      // For arrays, use CONTAINS for each element (joined with OR within the array, AND with other filters)
      const arrayExpressions = (value as (string | number | boolean)[]).map((item) => {
        if (typeof item === 'string') {
          return `${fieldName} CONTAINS "${item}"`;
        } else if (typeof item === 'number') {
          return `${fieldName} CONTAINS ${item}`;
        } else {
          return `${fieldName} CONTAINS ${item}`;
        }
      });
      if (arrayExpressions.length > 0) {
        expressions.push(`(${arrayExpressions.join(' OR ')})`);
      }
    }
  }

  return expressions.join(' AND ');
}

/**
 * Check if filters object contains at least one usable metadata filter value
 * Ensures the hasMetadataFilters flag reflects actual filtering constraints
 */
export function hasUsableMetadataFilters(filters?: Record<string, unknown>): boolean {
  if (!filters) {
    return false;
  }

  return Object.values(filters).some((value) => {
    if (value === null || value === undefined) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((entry) => entry !== null && entry !== undefined);
    }

    const valueType = typeof value;
    return valueType === 'string' || valueType === 'number' || valueType === 'boolean';
  });
}

/**
 * Try to extract JSON object/array from text that may have surrounding content.
 * Handles: ```json {...}```, raw {...}, or last top-level {...} in text.
 */
function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    const inner = jsonBlockMatch[1].trim();
    if (
      (inner.startsWith('{') && inner.includes('}')) ||
      (inner.startsWith('[') && inner.includes(']'))
    ) {
      return inner;
    }
  }
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          return trimmed.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Safely parse JSON with enhanced error messages.
 * Falls back to extracting JSON from surrounding text (for local models that add prose).
 */
export function safeJsonParse<T>(payload: string, context: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch {
    const extracted = extractJsonFromText(payload);
    if (extracted) {
      try {
        return JSON.parse(extracted) as T;
      } catch (parseError) {
        const preview = payload.substring(0, 200);
        throw new Error(
          `Failed to parse ${context} as JSON. ` +
            `Error: ${(parseError as Error).message}. ` +
            `Response preview: ${preview}...`
        );
      }
    }
    const preview = payload.substring(0, 200);
    throw new Error(
      `Failed to parse ${context} as JSON. No valid JSON found in response. ` +
        `Response preview: ${preview}...`
    );
  }
}
