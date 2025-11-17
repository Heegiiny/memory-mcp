-- =====================================================================
-- Migration: 20250117000001_init_postgres_schema
-- Description: Initialize Postgres schema for Memory MCP with pgvector
-- =====================================================================
-- This migration creates the core schema for per-project Postgres databases,
-- including pgvector extension, tables for memories, indexes, relationships,
-- and usage logging. Designed to replace Upstash Search backend.
-- =====================================================================

-- =====================================================================
-- UP Migration
-- =====================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- Table: memory_indexes
-- Purpose: Logical namespaces for organizing memories (similar to Upstash indexes)
-- Each project can have multiple indexes (e.g., 'personal', 'work', 'research')
-- =====================================================================

CREATE TABLE memory_indexes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project, name),
  -- Composite unique constraint for enforcing project isolation in foreign keys
  UNIQUE (id, project)
);

-- Note: idx_memory_indexes_project removed - UNIQUE (project, name) already provides B-tree index on project
CREATE INDEX idx_memory_indexes_name ON memory_indexes(name);

COMMENT ON TABLE memory_indexes IS 'Logical namespaces for organizing memories per project';
COMMENT ON COLUMN memory_indexes.project IS 'Project identifier (each project typically has its own database)';
COMMENT ON COLUMN memory_indexes.name IS 'Index name within the project (e.g., youtube-scripts, crm-notes)';
COMMENT ON COLUMN memory_indexes.metadata IS 'Extensible metadata for index-level configuration';

-- =====================================================================
-- Table: memories
-- Purpose: Core memory storage with embeddings, dynamics, and metadata
-- Stores atomic facts with rich metadata for semantic search and lifecycle management
-- =====================================================================

CREATE TABLE memories (
  id TEXT PRIMARY KEY, -- Format: mem_<uuid> for compatibility with Upstash backend
  index_id UUID NOT NULL,
  project TEXT NOT NULL,
  -- Composite foreign key ensures memories can only reference indexes from same project
  FOREIGN KEY (index_id, project) REFERENCES memory_indexes(id, project) ON DELETE CASCADE,

  -- Content
  content TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL, -- OpenAI text-embedding-3-small dimension

  -- Core metadata (hot columns for filtering/sorting)
  memory_type TEXT NOT NULL, -- self, belief, pattern, episodic, semantic
  topic TEXT,
  importance SMALLINT NOT NULL DEFAULT 0, -- 0=low, 1=medium, 2=high (maps to low/medium/high)
  tags TEXT[] DEFAULT '{}',

  -- Source tracking
  source TEXT, -- user, file, system
  source_path TEXT,
  channel TEXT,

  -- Lifecycle dynamics (used in priority calculations and decay)
  initial_priority REAL NOT NULL DEFAULT 0.0,
  current_priority REAL NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  max_access_count INTEGER NOT NULL DEFAULT 0,
  stability TEXT DEFAULT 'tentative', -- tentative, stable, canonical
  sleep_cycles INTEGER NOT NULL DEFAULT 0,

  -- Consolidation metadata
  kind TEXT DEFAULT 'raw', -- raw, summary, derived
  derived_from_ids TEXT[], -- Array of memory IDs (mem_<uuid> format)
  superseded_by_id TEXT REFERENCES memories(id) ON DELETE SET NULL,

  -- Extended metadata (less frequently queried fields)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  CONSTRAINT memories_importance_check CHECK (importance BETWEEN 0 AND 2),
  CONSTRAINT memories_priority_check CHECK (initial_priority BETWEEN 0.0 AND 1.0 AND current_priority BETWEEN 0.0 AND 1.0),
  CONSTRAINT memories_stability_check CHECK (stability IN ('tentative', 'stable', 'canonical')),
  CONSTRAINT memories_kind_check CHECK (kind IN ('raw', 'summary', 'derived')),
  CONSTRAINT memories_memory_type_check CHECK (memory_type IN ('self', 'belief', 'pattern', 'episodic', 'semantic'))
);

-- B-tree indexes for common query patterns
-- Note: 'project' removed as leading column since it's constant in per-project databases
-- This allows Postgres to use these indexes efficiently for actual filter/sort operations
CREATE INDEX idx_memories_index ON memories(index_id);
CREATE INDEX idx_memories_type_topic ON memories(memory_type, topic);
CREATE INDEX idx_memories_importance_priority ON memories(importance DESC, current_priority DESC);
CREATE INDEX idx_memories_recency ON memories(created_at DESC);
CREATE INDEX idx_memories_last_accessed ON memories(last_accessed_at DESC);
-- Partial index for active (non-superseded) memories with priority ordering
CREATE INDEX idx_memories_active_priority ON memories(current_priority DESC, created_at DESC) WHERE superseded_by_id IS NULL;
CREATE INDEX idx_memories_tags ON memories USING GIN (tags); -- GIN index for array containment queries

-- Composite index for priority + recency ordering (common recall pattern)
CREATE INDEX idx_memories_priority_recency ON memories(current_priority DESC, last_accessed_at DESC);

-- pgvector ANN index for semantic search
-- Using ivfflat for predictable performance (lists ~1-2% of expected rows)
-- Note: ivfflat with lists > 1 requires at least 'lists' rows to initialize centroids
-- Start with lists=1 for empty databases, increase after data accumulation
-- After loading data: ALTER INDEX idx_memories_embedding_ivfflat SET (lists = 100); REINDEX INDEX idx_memories_embedding_ivfflat;
CREATE INDEX idx_memories_embedding_ivfflat ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 1);

COMMENT ON TABLE memories IS 'Core memory storage with embeddings, lifecycle dynamics, and semantic metadata';
COMMENT ON COLUMN memories.embedding IS 'Vector embedding (1536-dim for text-embedding-3-small)';
COMMENT ON COLUMN memories.memory_type IS 'Semantic type: self (identity), belief (principles), pattern (behaviors), episodic (events), semantic (facts)';
COMMENT ON COLUMN memories.importance IS 'Priority signal: 0=low, 1=medium, 2=high';
COMMENT ON COLUMN memories.current_priority IS 'Computed priority (0.0-1.0) based on recency, importance, usage';
COMMENT ON COLUMN memories.stability IS 'Lifecycle maturity: tentative (new), stable (validated), canonical (core knowledge)';
COMMENT ON COLUMN memories.kind IS 'Memory provenance: raw (original), summary (consolidated), derived (computed)';
COMMENT ON COLUMN memories.superseded_by_id IS 'ID of newer memory that replaces this one (for consolidation)';
COMMENT ON COLUMN memories.derived_from_ids IS 'Source memory IDs for summaries and derived memories';

-- =====================================================================
-- Table: memory_relationships
-- Purpose: Typed edges connecting memories in a knowledge graph
-- Enables relationship-based retrieval and consolidation
-- =====================================================================

CREATE TABLE memory_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- summarizes, supports, contradicts, causes, similar_to, etc.
  confidence REAL DEFAULT 1.0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source_id, target_id, relationship_type),
  CONSTRAINT memory_relationships_confidence_check CHECK (confidence BETWEEN 0.0 AND 1.0),
  CONSTRAINT memory_relationships_type_check CHECK (relationship_type IN (
    'summarizes',
    'example_of',
    'is_generalization_of',
    'supports',
    'contradicts',
    'causes',
    'similar_to',
    'historical_version_of',
    'derived_from'
  ))
);

CREATE INDEX idx_memory_relationships_source ON memory_relationships(source_id);
CREATE INDEX idx_memory_relationships_target ON memory_relationships(target_id);
-- Note: 'project' removed as leading column for per-project database optimization
CREATE INDEX idx_memory_relationships_type ON memory_relationships(relationship_type);

COMMENT ON TABLE memory_relationships IS 'Typed edges connecting memories in a knowledge graph';
COMMENT ON COLUMN memory_relationships.relationship_type IS 'Semantic edge type (summarizes, supports, contradicts, causes, similar_to, etc.)';
COMMENT ON COLUMN memory_relationships.confidence IS 'Relationship strength (0.0-1.0)';

-- =====================================================================
-- Table: memory_usage_log
-- Purpose: Audit trail for memory operations and access patterns
-- Tracks tool invocations, priority adjustments, and performance metrics
-- =====================================================================

CREATE TABLE memory_usage_log (
  id BIGSERIAL PRIMARY KEY,
  project TEXT NOT NULL,
  memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  index_id UUID REFERENCES memory_indexes(id) ON DELETE SET NULL,

  -- Operation metadata
  action TEXT NOT NULL, -- memorize, recall, forget, refine
  tool_name TEXT,
  success BOOLEAN NOT NULL,
  latency_ms INTEGER,

  -- Priority tracking (for decay/reinforcement analysis)
  priority_before REAL,
  priority_after REAL,

  -- Audit metadata
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT memory_usage_log_action_check CHECK (action IN ('memorize', 'recall', 'forget', 'refine', 'scan'))
);

-- Note: 'project' removed as leading column for per-project database optimization
CREATE INDEX idx_memory_usage_log_accessed ON memory_usage_log(accessed_at DESC);
CREATE INDEX idx_memory_usage_log_memory ON memory_usage_log(memory_id, accessed_at DESC);
CREATE INDEX idx_memory_usage_log_index ON memory_usage_log(index_id, accessed_at DESC);
CREATE INDEX idx_memory_usage_log_action ON memory_usage_log(action, accessed_at DESC);

COMMENT ON TABLE memory_usage_log IS 'Audit trail for memory operations and access patterns';
COMMENT ON COLUMN memory_usage_log.action IS 'Tool operation: memorize, recall, forget, refine, scan';
COMMENT ON COLUMN memory_usage_log.priority_before IS 'Priority before operation (for tracking reinforcement/decay)';
COMMENT ON COLUMN memory_usage_log.priority_after IS 'Priority after operation (for tracking reinforcement/decay)';

-- =====================================================================
-- Trigger: Update memories.updated_at on modification
-- =====================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================================
-- Initial data: Create default index for testing/quickstart
-- =====================================================================

-- Insert default 'memory' index for backward compatibility with existing configs
INSERT INTO memory_indexes (project, name, description, metadata)
VALUES (
  'default',
  'memory',
  'Default memory index for quickstart and testing',
  '{"created_by": "migration", "version": "1.0.0"}'::jsonb
)
ON CONFLICT (project, name) DO NOTHING;

-- =====================================================================
-- DOWN Migration (Rollback)
-- =====================================================================

-- DROP TABLE memory_usage_log CASCADE;
-- DROP TABLE memory_relationships CASCADE;
-- DROP TABLE memories CASCADE;
-- DROP TABLE memory_indexes CASCADE;
-- DROP EXTENSION IF EXISTS vector CASCADE;
-- DROP EXTENSION IF EXISTS pgcrypto CASCADE;
-- DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;

-- Note: Uncomment the above lines to enable rollback
-- For safety, rollback is commented out by default
-- Run manually if you need to tear down the schema
