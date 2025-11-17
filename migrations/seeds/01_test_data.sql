-- =====================================================================
-- Seed Data: Test Fixtures for Memory MCP Postgres Backend
-- =====================================================================
-- This file provides sample data for testing and CI environments.
-- Run after the initial schema migration is complete.
--
-- Usage:
--   psql $DATABASE_URL -f migrations/seeds/01_test_data.sql
-- =====================================================================

-- =====================================================================
-- Setup: Create test project and indexes
-- =====================================================================

-- Create test project indexes
INSERT INTO memory_indexes (project, name, description, metadata) VALUES
  ('test', 'youtube-scripts', 'Test index for YouTube script memories', '{"category": "content", "test": true}'::jsonb),
  ('test', 'crm-notes', 'Test index for CRM notes', '{"category": "business", "test": true}'::jsonb),
  ('test', 'personal', 'Test index for personal memories', '{"category": "personal", "test": true}'::jsonb)
ON CONFLICT (project, name) DO NOTHING;

-- =====================================================================
-- Test Data: Sample memories with varied types and metadata
-- =====================================================================

-- Helper: Generate a dummy embedding vector (1536 dimensions)
-- In production, embeddings come from OpenAI's text-embedding-3-large
-- For testing, we use a simple pattern: [0.1, 0.2, 0.1, 0.2, ...]
DO $$
DECLARE
  youtube_idx UUID;
  crm_idx UUID;
  personal_idx UUID;
  mem1_id UUID;
  mem2_id UUID;
  mem3_id UUID;
  mem4_id UUID;
  mem5_id UUID;
  dummy_embedding vector(1536);
BEGIN
  -- Get index IDs
  SELECT id INTO youtube_idx FROM memory_indexes WHERE project = 'test' AND name = 'youtube-scripts';
  SELECT id INTO crm_idx FROM memory_indexes WHERE project = 'test' AND name = 'crm-notes';
  SELECT id INTO personal_idx FROM memory_indexes WHERE project = 'test' AND name = 'personal';

  -- Generate dummy embedding (alternating 0.1 and 0.2 for all 1536 dimensions)
  SELECT array_agg(CASE WHEN i % 2 = 0 THEN 0.1::real ELSE 0.2::real END)::vector(1536)
  INTO dummy_embedding
  FROM generate_series(1, 1536) i;

  -- ===================================================================
  -- Memory Type: EPISODIC (specific events with temporal context)
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, source_path, channel, initial_priority, current_priority,
    created_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'In episode 42, I discussed the psychology of pricing anchors and how showing a $999 plan makes $499 seem reasonable.',
    dummy_embedding,
    'episodic', 'pricing-psychology', 1,
    ARRAY['episode-42', 'pricing', 'psychology', 'anchoring'],
    'file', 'scripts/ep42-pricing.md', 'TestChannel',
    0.6, 0.58, -- Initial: medium importance, slight decay
    NOW() - INTERVAL '15 days', 12, 'stable', 'raw'
  ) RETURNING id INTO mem1_id;

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, channel, initial_priority, current_priority,
    created_at, last_accessed_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'During the Q&A livestream on 2024-12-15, I answered a question about burnout by emphasizing the importance of consistent breaks.',
    dummy_embedding,
    'episodic', 'creator-wellness', 2,
    ARRAY['livestream', 'qa', 'burnout', 'wellness'],
    'user', 'TestChannel',
    0.9, 0.85, -- High importance, frequently accessed
    NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 days', 25, 'stable', 'raw'
  ) RETURNING id INTO mem2_id;

  -- ===================================================================
  -- Memory Type: BELIEF (principles and convictions)
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'I believe creators should prioritize consistency over perfection. Shipping regularly builds audience trust more than waiting for the perfect video.',
    dummy_embedding,
    'belief', 'content-strategy', 2,
    ARRAY['consistency', 'perfection', 'strategy'],
    'user',
    0.9, 0.88, -- High importance, resists decay
    NOW() - INTERVAL '60 days', 8, 'canonical', 'raw'
  ) RETURNING id INTO mem3_id;

  -- ===================================================================
  -- Memory Type: PATTERN (repeated behaviors and procedures)
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'When asked about monetization, I usually start by explaining that ad revenue is unreliable and recommend building multiple income streams (sponsorships, products, memberships).',
    dummy_embedding,
    'pattern', 'monetization-advice', 1,
    ARRAY['monetization', 'revenue', 'advice'],
    'user',
    0.6, 0.55,
    NOW() - INTERVAL '45 days', 5, 'stable', 'raw'
  ) RETURNING id INTO mem4_id;

  -- ===================================================================
  -- Memory Type: SEMANTIC (general facts and domain knowledge)
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'YouTube algorithm prioritizes watch time and click-through rate (CTR). Videos with >50% average view duration and >10% CTR typically perform well.',
    dummy_embedding,
    'semantic', 'platform-knowledge', 1,
    ARRAY['youtube', 'algorithm', 'metrics'],
    'system',
    0.6, 0.6, -- Medium importance, slow decay
    NOW() - INTERVAL '90 days', 3, 'stable', 'raw'
  ) RETURNING id INTO mem5_id;

  -- ===================================================================
  -- Memory Type: SELF (identity and stable traits)
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, channel, initial_priority, current_priority,
    created_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), personal_idx, 'test',
    'I am a software engineer who prefers asynchronous communication and values deep work time over constant meetings.',
    dummy_embedding,
    'self', 'work-preferences', 2,
    ARRAY['identity', 'work-style', 'preferences'],
    'user', 'TestUser',
    0.9, 0.92, -- Very high importance, extremely resistant to decay
    NOW() - INTERVAL '120 days', 15, 'canonical', 'raw'
  );

  -- ===================================================================
  -- CRM Test Data
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind
  ) VALUES (
    gen_random_uuid(), crm_idx, 'test',
    'Client Acme Corp prefers weekly status updates via email on Fridays. Key contact: Jane Smith (jane@acme.com).',
    dummy_embedding,
    'semantic', 'client-preferences', 2,
    ARRAY['acme-corp', 'communication', 'client'],
    'user',
    0.9, 0.87,
    NOW() - INTERVAL '20 days', 18, 'stable', 'raw'
  );

  -- ===================================================================
  -- Derived/Summary Memory (consolidation examples)
  -- ===================================================================

  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind, derived_from_ids
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'Summary: My approach to content creation emphasizes consistency, multiple revenue streams, and understanding platform algorithms. Key themes: pricing psychology, creator wellness, and practical monetization advice.',
    dummy_embedding,
    'belief', 'content-philosophy', 2,
    ARRAY['summary', 'philosophy', 'strategy'],
    'system',
    0.9, 0.9,
    NOW() - INTERVAL '5 days', 2, 'tentative', 'summary',
    ARRAY[mem1_id, mem2_id, mem3_id, mem4_id] -- References source memories
  );

  -- Derived memory (computed from pattern analysis)
  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind, derived_from_ids
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'Derived insight: Based on recurring Q&A patterns, audience is most interested in sustainable growth strategies over quick hacks. Priority topics: monetization diversity, burnout prevention, algorithm understanding.',
    dummy_embedding,
    'pattern', 'audience-insights', 2,
    ARRAY['derived', 'patterns', 'audience'],
    'system',
    0.85, 0.85,
    NOW() - INTERVAL '3 days', 1, 'stable', 'derived',
    ARRAY[mem2_id, mem4_id] -- Derived from Q&A and monetization patterns
  );

  -- ===================================================================
  -- Superseded Memory (example of lifecycle management)
  -- ===================================================================

  -- Old version
  INSERT INTO memories (
    id, index_id, project, content, embedding, memory_type, topic, importance,
    tags, source, initial_priority, current_priority,
    created_at, access_count, stability, kind, superseded_by_id
  ) VALUES (
    gen_random_uuid(), youtube_idx, 'test',
    'Old belief: I used to think posting daily was essential for growth.',
    dummy_embedding,
    'belief', 'content-strategy', 0,
    ARRAY['outdated', 'posting-frequency'],
    'user',
    0.3, 0.1,
    NOW() - INTERVAL '180 days', 1, 'tentative', 'raw',
    mem3_id -- Superseded by the "consistency over perfection" belief
  );

  -- ===================================================================
  -- Memory Relationships (knowledge graph edges)
  -- ===================================================================

  -- mem1 (pricing episode) supports mem3 (consistency belief)
  INSERT INTO memory_relationships (project, source_id, target_id, relationship_type, confidence)
  VALUES ('test', mem1_id, mem3_id, 'supports', 0.85);

  -- mem2 (burnout Q&A) supports mem3 (consistency belief)
  INSERT INTO memory_relationships (project, source_id, target_id, relationship_type, confidence)
  VALUES ('test', mem2_id, mem3_id, 'supports', 0.75);

  -- mem4 (monetization pattern) is an example_of mem3 (strategy belief)
  INSERT INTO memory_relationships (project, source_id, target_id, relationship_type, confidence)
  VALUES ('test', mem4_id, mem3_id, 'example_of', 0.9);

  -- ===================================================================
  -- Usage Log (sample audit trail)
  -- ===================================================================

  INSERT INTO memory_usage_log (
    project, memory_id, index_id, action, tool_name, success, latency_ms,
    priority_before, priority_after, accessed_at
  ) VALUES
    ('test', mem1_id, youtube_idx, 'recall', 'recall', true, 145, 0.60, 0.61, NOW() - INTERVAL '10 days'),
    ('test', mem1_id, youtube_idx, 'recall', 'recall', true, 132, 0.61, 0.62, NOW() - INTERVAL '5 days'),
    ('test', mem2_id, youtube_idx, 'recall', 'recall', true, 98, 0.83, 0.84, NOW() - INTERVAL '3 days'),
    ('test', mem3_id, youtube_idx, 'recall', 'recall', true, 112, 0.88, 0.88, NOW() - INTERVAL '1 day'),
    ('test', mem4_id, youtube_idx, 'refine', 'refine_memories', true, 523, 0.58, 0.55, NOW() - INTERVAL '7 days');

END $$;

-- =====================================================================
-- Verification Queries
-- =====================================================================

-- Check memory counts by type
SELECT memory_type, COUNT(*) as count
FROM memories
WHERE project = 'test'
GROUP BY memory_type
ORDER BY count DESC;

-- Check relationships
SELECT
  r.relationship_type,
  COUNT(*) as count
FROM memory_relationships r
WHERE r.project = 'test'
GROUP BY r.relationship_type;

-- Check indexes
SELECT name, description,
  (SELECT COUNT(*) FROM memories WHERE index_id = mi.id) as memory_count
FROM memory_indexes mi
WHERE project = 'test';

-- Display sample memories
SELECT
  id,
  LEFT(content, 80) as content_preview,
  memory_type,
  topic,
  importance,
  current_priority,
  access_count,
  stability
FROM memories
WHERE project = 'test'
ORDER BY current_priority DESC
LIMIT 10;

-- Success message
DO $$ BEGIN
  RAISE NOTICE 'Seed data loaded successfully! Run verification queries above to inspect.';
END $$;
