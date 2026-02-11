-- Migration: Switch embedding dimension from 1536 (OpenAI) to 1024 (bge-m3)
-- Run when using Ollama bge-m3 model. Table should be empty.

DROP INDEX IF EXISTS idx_memories_embedding_ivfflat;
ALTER TABLE memories DROP COLUMN embedding;
ALTER TABLE memories ADD COLUMN embedding vector(1024) NOT NULL;
CREATE INDEX idx_memories_embedding_ivfflat ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 1);
