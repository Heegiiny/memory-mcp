export interface EmbeddingConfig {
  model: string;
  dimensions: number;
}

export const KNOWN_EMBEDDING_MODELS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'nomic-embed-text': 768, // Ollama: ollama pull nomic-embed-text
  'bge-m3': 1024, // Ollama: ollama pull bge-m3
};

export function loadEmbeddingConfig(): EmbeddingConfig {
  const model = process.env.MEMORY_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  const dimensionsEnv = process.env.MEMORY_EMBEDDING_DIMENSIONS?.trim();

  let dimensions = KNOWN_EMBEDDING_MODELS[model];
  if (dimensionsEnv) {
    const parsed = Number(dimensionsEnv);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid MEMORY_EMBEDDING_DIMENSIONS value: "${dimensionsEnv}".`);
    }
    dimensions = parsed;
  }

  if (!dimensions) {
    throw new Error(
      `Embedding dimensions unknown for model "${model}". Either use a known model or set MEMORY_EMBEDDING_DIMENSIONS.`
    );
  }

  return { model, dimensions };
}
