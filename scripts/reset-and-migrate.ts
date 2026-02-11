#!/usr/bin/env tsx
/**
 * Drop existing tables and run full migration.
 * Run as: DATABASE_URL=... npx tsx scripts/reset-and-migrate.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('postgres')) {
  console.error('❌ DATABASE_URL required');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  console.log('🗑️  Dropping existing tables...');
  await client.query(`
    DROP TRIGGER IF EXISTS memories_updated_at ON memories;
    DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
    DROP TABLE IF EXISTS memory_usage_log CASCADE;
    DROP TABLE IF EXISTS memory_relationships CASCADE;
    DROP TABLE IF EXISTS memories CASCADE;
    DROP TABLE IF EXISTS memory_indexes CASCADE;
  `);
  console.log('✅ Dropped.\n');

  console.log('📄 Running migration...');
  const sql = readFileSync(
    join(projectRoot, 'migrations/20250117000001_init_postgres_schema.sql'),
    'utf-8'
  );
  // Skip extension creation (assume already exists)
  const migration = sql
    .replace(/CREATE EXTENSION IF NOT EXISTS vector;\n/, '')
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;\n/, '');
  await client.query(migration);
  console.log('✅ Migration complete.\n');

  // Run other migrations
  const migs = [
    '20250118000001_add_index_id_to_relationships.sql',
    '20250119000000_remove_dynamics_and_add_indexes.sql',
    '20250120000000_add_temporal_consolidation.sql',
    '20250211000000_bge_m3_1024_vectors.sql',
  ];
  for (const f of migs) {
    try {
      const s = readFileSync(join(projectRoot, 'migrations', f), 'utf-8');
      await client.query(s);
      console.log(`✅ ${f}`);
    } catch (e: unknown) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === '42P07') {
        console.log(`⏭️  ${f} (already applied)`);
      } else {
        throw e;
      }
    }
  }

  await client.end();
  console.log('\n🎉 Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
