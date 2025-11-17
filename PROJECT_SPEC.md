Below is a single, end‑to‑end rebuild plan (“mega spec”) to replace the Upstash Search backend with PostgreSQL + pgvector in a fresh repository. It assumes you will **start clean**, copy across only the minimal domain contracts and prompts, and wire the MCP server to a Postgres repository. Where it helps, it references files in the legacy codebase using the `@` notation so you can open them for context.

---

## 0) Goals, non‑goals, and success criteria

**Goals**

* Replace the Upstash backend with a clean PostgreSQL + pgvector implementation.
* Preserve the existing Memory MCP tool contract (memorize / recall / forget / refine_memories / create_index / list_indexes) and agent behavior where it still makes sense.
* Keep the “AI‑first” architecture (LLM + tools) but simplify the data layer and config.
* Make index management and search semantics deterministic, fast, and debuggable.

**Non‑goals (this pass)**

* Port of unit/integration tests. You’ll discard tests now and reintroduce later.
* Upholding Upstash‑specific features like “pending documents” counters.

**Success criteria**

* `MEMORY_BACKEND=postgres` starts the MCP server without throwing the “not yet supported” error currently hardcoded in @src/server/MemoryServer.ts. 
* `memorize`, `recall`, `forget`, `refine_memories`, `create_index`, `list_indexes` operate against Postgres.
* Embedding model + pgvector dimension alignment is validated at startup (see @src/config/embedding.ts for model↔dims mapping). 

---

## 1) New repository layout

Create a new folder (e.g., `memory-pg`) with this structure:

```
memory-pg/
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── src/
│   ├── index.ts
│   ├── server/
│   │   └── MemoryServer.ts
│   ├── config/
│   │   ├── backend.ts
│   │   ├── debug.ts
│   │   ├── embedding.ts
│   │   └── refinement.ts
│   ├── llm/
│   │   ├── LLMClient.ts
│   │   ├── EmbeddingService.ts
│   │   ├── PromptManager.ts
│   │   └── MemoryAgent.ts
│   ├── memory/
│   │   ├── IMemoryRepository.ts
│   │   ├── types.ts
│   │   ├── PriorityCalculator.ts
│   │   ├── MemoryController.ts
│   │   ├── postgres/
│   │   │   └── FilterParser.ts
│   │   ├── MemoryRepositoryPostgres.ts
│   │   ├── PoolManager.ts
│   │   └── MemorySearchError.ts
│   └── utils/
│       ├── logger.ts
│       └── RetryStrategy.ts
├── migrations/
│   ├── 20250117000001_init_postgres_schema.sql
│   └── seeds/
│       └── 01_test_data.sql
└── prompts/
    ├── memory-base.txt
    ├── memory-memorize.txt
    ├── memory-recall.txt
    ├── memory-forget.txt
    ├── memory-refine.txt
    └── README.md
```

> Rationale and source references: this mirrors the useful parts of the legacy tree (LLM agent, controller, prompts, config), but drops Upstash‑only surfaces and test scaffolding. The referenced legacy files show the contracts and modules we’ll keep: @src/memory/IMemoryRepository.ts, @src/memory/types.ts, @src/llm/EmbeddingService.ts, @src/config/embedding.ts, @src/memory/PriorityCalculator.ts, @src/memory/MemoryController.ts, @src/memory/postgres/FilterParser.ts, @src/memory/PoolManager.ts.

---

## 2) Environment & configuration

Add the following to `.env.example`:

```
# Backend
MEMORY_BACKEND=postgres

# Postgres project registry (JSON file mapping projectId -> { databaseUrl })
MEMORY_POSTGRES_PROJECT_REGISTRY=./config/projects.json
MEMORY_ACTIVE_PROJECT=default

# OpenAI
OPENAI_API_KEY=...
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
# Set if you want to override the detected dims; otherwise inferred (small=1536, large=3072)
# MEMORY_EMBEDDING_DIMENSIONS=1536

# MCP host message (inline text or path)
# MEMORY_MCP_SYSTEM_MESSAGE=./config/memory-host-context.txt

# Optional: debug flags
# MEMORY_DEBUG_MODE=true
# MEMORY_DEBUG_OPERATIONS=true
# MEMORY_DEBUG_VALIDATION=true
# MEMORY_DEBUG_ACCESS_TRACKING=true
```

**Backend configuration**
Reuse the clean design from @src/config/backend.ts, which supports `MEMORY_BACKEND=postgres` and loads a registry JSON mapping project IDs to DB URLs, resolving `MEMORY_ACTIVE_PROJECT`. Keep this exactly; it’s solid and decoupled. 

**Embedding config**
Keep the model↔dimension logic from @src/config/embedding.ts (KNOWN_EMBEDDING_MODELS and `loadEmbeddingConfig()`) so runtime can validate schema compatibility. 

---

## 3) Database schema (pgvector)

Adopt the schema as documented in @migrations/README.md and ship the existing initial migration under `migrations/20250117000001_init_postgres_schema.sql`. It enables `vector` and `pgcrypto`, creates `memory_indexes`, `memories`, `memory_relationships`, `memory_usage_log`, with ANN index on `memories.embedding`. 

Also include the seed file `migrations/seeds/01_test_data.sql` for manual smoke checks; it uses dummy 1536‑dim embeddings (aligned with `text-embedding-3-small`). 

---

## 4) Domain contracts to keep (verbatim or nearly so)

* **Types**: port @src/memory/types.ts fully (MemoryRecord, SearchResult, metadata/lifecycle fields). The docs excerpt in @README.md describes dynamics, relationships, and refinement actions; keep that model. 
* **Priority calculator**: port @src/memory/PriorityCalculator.ts; it underpins `currentPriority` updates and is tested to behave deterministically across time windows. 
* **IMemoryRepository**: port @src/memory/IMemoryRepository.ts as the core storage boundary (upsert/search/delete/get/getMemories/testIndex/getDatabaseInfo/listIndexes). 

> **Small extension**: add one method to the interface for explicit index management in Postgres:
>
> ```ts
> ensureIndex(indexName: string, description?: string): Promise<{ name: string; created: boolean }>;
> ```
>
> Reason: Upstash didn’t need explicit creation. Postgres should create/describe indexes deterministically instead of relying on implicit creation during first upsert.

---

## 5) Backend implementation (Postgres)

### 5.1 Pooling

Port @src/memory/PoolManager.ts as-is (singleton, keyed by connection string). It’s already production‑grade and logs safely. 

### 5.2 Filter grammar

Port @src/memory/postgres/FilterParser.ts. It converts the legacy “@metadata.* …” filter DSL into SQL/JSONB predicates. Keep the same surface so callers can pass `filterExpression` unchanged. 

### 5.3 Repository

Create `src/memory/MemoryRepositoryPostgres.ts` modeled on the existing version: connection via PoolManager, `pgvector` cosine similarity, batch upserts with `ON CONFLICT`, JSONB metadata, and “access tracking” updates. The legacy file already implements all of that; reuse its approach and SQL, but wire it to the new project config (active project’s DB URL). 

Key points to keep from the legacy implementation:

* **Auto index resolution**: `resolveIndexId(name)` with `INSERT ... ON CONFLICT` to create the index row on first use. 
* **Embedding alignment**: validate vector size against embedding config; throw clear error on mismatch (see @src/llm/EmbeddingService.ts behavior). 
* **Search**: `SELECT ... ORDER BY embedding <=> $queryVec` (cosine distance) with optional filter predicates generated by FilterParser. Reranking can be left off by default initially, then added later. (Keep the diagnostics pattern introduced by MemorySearchError.) 
* **Access tracking**: `searchMemories()` and `getMemory()` should trigger a fire‑and‑forget `updateAccessStats(index, ids)` that increments `accessCount`, adjusts `currentPriority` using @src/memory/PriorityCalculator.ts, and clamps to [0.0, 1.0]. The existing tests describe the intended behavior. 
* **DatabaseInfo / listIndexes**: Implement as simple counts over `memories` joined to `memory_indexes`. No “pending documents” in Postgres—always zero. 

Add the new **ensureIndex**:

* Insert or update `memory_indexes (project, name, description)`; return `{ created: true|false }`.

---

## 6) LLM & embeddings

* **Embedding service**: Port @src/llm/EmbeddingService.ts unchanged. It already supports configuring the model and expected dimensions and gives precise errors when OpenAI returns a different size. 
* **Embedding config**: Keep @src/config/embedding.ts to resolve model/dims from env. 
* **LLM client**: Port @src/llm/LLMClient.ts and its “tools” interface unchanged. 

---

## 7) Agent, controller, prompts

* **Prompts**: Copy the `prompts/` files (base/memorize/recall/forget/refine) verbatim; they’re backend‑agnostic and already validated in the current agent flow. @prompts/README.md gives the composition model. 
* **PromptManager**: Port @src/llm/PromptManager.ts; it supports inline or file‑path host messages. 
* **MemoryAgent**: Port @src/llm/MemoryAgent.ts, but remove reliance on the file‑based IndexManager for any operation that should now be DB‑native:

  * `create_index` should call `repo.ensureIndex(name, description)`, then return the merged info. The current implementation mingles Upstash stats + local JSON config; switch to repository‑driven stats. The legacy method shows how the Upstash path worked and what the return payload looked like. 
  * `list_indexes` should call `repo.listIndexes()` (and may augment with descriptions now stored in `memory_indexes`). The legacy logic merged Upstash DB info + local config; use DB only. 
  * Keep memorize/recall/forget/refine_memories behaviors and diagnostics exactly; they are storage‑agnostic already (they call the repository). See usages in @src/llm/agent/operations/memorize/MemorizeOperation.ts and MemoryAgent’s scan tool path.
* **MemoryController**: Port @src/memory/MemoryController.ts with no interface changes; it delegates to the agent and resolves the index with `IndexResolver`. 
* **IndexResolver**: Port @src/memory/IndexResolver.ts; keep validation rules and default index logic. 

> Drop **IndexManager** (file‑based) entirely for Postgres mode. The DB becomes the source of truth for index registration/description.

---

## 8) Server wiring (MCP)

* **CreateMemoryServer**: In the legacy server, the Postgres branch purposefully throws (“not yet supported”). Replace that branch so it:

  1. Loads backend config via `loadBackendConfig()` and embedding config via `loadEmbeddingConfig()`. @src/config/backend.ts, @src/config/embedding.ts.
  2. Creates `EmbeddingService` and `MemoryRepositoryPostgres` with the active project’s `databaseUrl`. @src/llm/EmbeddingService.ts, @src/memory/MemoryRepositoryPostgres.ts.
  3. Wires `MemoryAgent`, `MemoryController`, `ProjectFileLoader`, `IndexResolver` (no IndexManager), and registers the MCP tools.
  4. Exposes the same tool schemas and routing as today.

See the current, working Upstash branch for handler registration and tool schemas in @src/server/MemoryServer.ts and mirror it for Postgres. 

---

## 9) Configuration files and scripts

* **package.json**: Start with a minimal version modeled on the legacy one. Keep `tsx` for `dev`, `tsc` for build, and a `start` script:

  ```json
  {
    "type": "module",
    "scripts": {
      "dev": "tsx src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js"
    },
    "dependencies": {
      "@modelcontextprotocol/sdk": "^1.22.0",
      "dotenv": "^17.2.3",
      "openai": "^6.9.0",
      "pg": "^8.16.3"
    },
    "devDependencies": {
      "@types/node": "^24.10.1",
      "tsx": "^4.20.6",
      "typescript": "^5.9.3"
    }
  }
  ```

  The legacy repo’s package shows the same baseline and versions you can reuse. 

* **.gitignore**: Copy the useful parts from the legacy file (node_modules, dist, .env, data, test-data). 

* **src/index.ts**: Keep the tiny bootstrap (create server → stdio transport). @src/index.ts. 

---

## 10) Step‑by‑step build plan (from a clean folder)

**Step 1 — Initialize project**

1. `npm init -y`
2. Add `typescript`, `tsx`, `dotenv`, `pg`, `openai`, MCP SDK as per package.json above.
3. Add `tsconfig.json` (ES2022, `"module": "esnext"`, `"outDir": "dist"`).
4. Create `.env.example` from section 2 and `.gitignore` from section 9.

**Step 2 — Copy/author configs & utils**

1. Copy @src/config/backend.ts and @src/config/embedding.ts.
2. Author `src/config/refinement.ts` by copying the legacy version (exposes default budget, access tracking). 
3. Copy @src/config/debug.ts and @src/utils/logger.ts (or keep a minimal logger signature used by PoolManager/repo). 

**Step 3 — Copy domain layer**

1. Copy @src/memory/types.ts, @src/memory/PriorityCalculator.ts, @src/memory/MemorySearchError.ts.
2. Copy @src/memory/IMemoryRepository.ts and add `ensureIndex(...)` as specified. 
3. Copy @src/memory/postgres/FilterParser.ts. 

**Step 4 — DB access**

1. Copy @src/memory/PoolManager.ts. 
2. Create `src/memory/MemoryRepositoryPostgres.ts` using the legacy file as your blueprint. Ensure all IMemoryRepository methods are implemented, plus `ensureIndex`. 

**Step 5 — LLM & embeddings**

1. Copy @src/llm/EmbeddingService.ts and @src/llm/LLMClient.ts.
2. Copy @src/llm/PromptManager.ts. 
3. Copy `prompts/` files.

**Step 6 — Agent & controller**

1. Copy @src/llm/MemoryAgent.ts, then:

   * Replace any uses of `IndexManager`:

     * `create_index` → calls `repo.ensureIndex` instead of touching a local JSON file. The old “merge Upstash stats + config” code is in @src/llm/MemoryAgent.ts; update to DB. 
     * `list_indexes` → `repo.listIndexes()`. 
   * Keep memorize / recall / forget / refine flows unchanged; they’re backend‑neutral and already call the repository (see the scan path in @src/llm/MemoryAgent.ts). 
2. Copy @src/memory/MemoryController.ts unchanged. 
3. Copy @src/memory/IndexResolver.ts unchanged. 

**Step 7 — Server**

1. Copy @src/server/MemoryServer.ts and replace the “postgres not yet supported” throw with Postgres wiring:

   * `const backend = loadBackendConfig()` → if `postgres`, pick `activeProject.databaseUrl`.
   * Construct `EmbeddingService` with `loadEmbeddingConfig()`.
   * Construct `MemoryRepositoryPostgres(databaseUrl, activeProjectId, embeddingService)`.
   * Construct the rest (PromptManager, LLMClient, ProjectFileLoader, MemoryAgent, MemoryController).
     The current Upstash path shows the exact handler registration and tool schemas; replicate for Postgres. 

**Step 8 — Migrations & seed**

1. Add @migrations/20250117000001_init_postgres_schema.sql and @migrations/seeds/01_test_data.sql to your new repo.
2. Provide a tiny `scripts/dev-db.sh` (optional) that runs `psql "$DATABASE_URL" -f ...` for the active project.

**Step 9 — Manual smoke check (no tests)**

1. `cp .env.example .env` and set:

   * `MEMORY_BACKEND=postgres`
   * `MEMORY_POSTGRES_PROJECT_REGISTRY=./config/projects.json`
   * `MEMORY_ACTIVE_PROJECT=default`
   * `OPENAI_API_KEY=...`
2. Create `config/projects.json` → `{ "default": { "databaseUrl": "postgresql://user:pass@localhost:5432/memory_default" } }` in the same shape validated in @src/config/backend.ts. 
3. Run migration: `psql "$DATABASE_URL" -f migrations/20250117000001_init_postgres_schema.sql`. 
4. Seed (optional): `psql "$DATABASE_URL" -f migrations/seeds/01_test_data.sql`. 
5. `npm run dev` → the MCP server should start without the postgres error that exists today in the legacy server. 

---

## 11) API and behavior details (must‑haves)

**IMemoryRepository (final surface)**

* `ensureIndex(name, description?)` — creates if absent, idempotent.
* `upsertMemories(index, memories[], defaultMetadata?) → string[]`
* `searchMemories(index, query, options?) → SearchResult[]`

  * `limit`, `filterExpression` (via FilterParser), `includeMetadata` default true.
  * Postgres has no “pending documents”; `SearchDiagnostics` reflects status `'results' | 'no_results'`.
* `getMemory(index, id) → MemoryRecord | null`
* `getMemories(index, ids[]) → MemoryRecord[]`
* `deleteMemories(index, ids[])`
* `updateAccessStats(index, ids[])`
* `testIndex(index) → boolean`
* `getDatabaseInfo() → { documentCount, pendingDocumentCount: 0, indexes }`
* `listIndexes() → { name, documentCount, pendingDocumentCount: 0 }[]`

> See current DB info and listIndexes implementations in the legacy Postgres repo for the exact SQL patterns to copy. 

**Embedding dimensions**
The schema’s `vector(1536)` must match the configured model (`text-embedding-3-small`→1536; `3-large`→3072). Runtime validation comes from @src/llm/EmbeddingService.ts and @src/config/embedding.ts; keep their behavior.

**Access tracking & priority**
Preserve the same lifecycle semantics (increment accessCount, decay/boost currentPriority, clamp to [0,1]) as exercised in the existing Postgres unit tests. The spec keeps those behaviors even though you’re not porting the tests yet. 

---

## 12) Observability and debug ergonomics

* Keep debug config surface (`MEMORY_DEBUG_*`) from @src/config/debug.ts and ensure the repo logs category‑appropriate messages: operation starts/ends, access tracking updates, and SQL failures. 
* Keep `MemorySearchError` with diagnostics for search‑path failures. 

---

## 13) Data migration (optional, if you want to preserve Upstash data)

If you need to move existing Upstash content:

1. Write a one‑off script `scripts/export-upstash.ts` using the legacy Upstash repository (@src/memory/MemoryRepository.ts) to fetch memories for each index. It already knows how to list indexes (`getDatabaseInfo` + `listIndexes`) and retrieve by ID. 
2. Emit JSON arrays per index: `{ id, text, metadata }[]`.
3. Write `scripts/import-postgres.ts` that:

   * Resolves the active project DB URL.
   * Calls `repo.ensureIndex(name, description?)`.
   * Calls `repo.upsertMemories(name, memories[])` in batches.
4. Verify with a few manual `recall` calls or direct SQL counts.

---

## 14) Deleting Upstash dependencies

* Remove any Upstash‑only configuration variables from your new repo’s documentation. In the legacy server, “Upstash required” checks live right after the “postgres not supported” throw; they disappear in the Postgres path. @src/server/MemoryServer.ts. 
* Drop `@upstash/search` from dependencies in the new repo’s package.json. The new backend is pure `pg`.

---

## 15) Cutover checklist

* [ ] Postgres running with pgvector (docker/neon/etc.); migration applied. @migrations/README.md. 
* [ ] `.env` populated; `projects.json` points `default` to your DB. @src/config/backend.ts. 
* [ ] `MEMORY_BACKEND=postgres` server boots successfully (no legacy “not supported” error). @src/server/MemoryServer.ts. 
* [ ] `create_index` creates rows in `memory_indexes` and appears in `list_indexes`. (Use `ensureIndex`.)
* [ ] `memorize` stores content (embedding generated), `recall` returns results ordered by cosine similarity, optional filters work via FilterParser. @src/memory/postgres/FilterParser.ts. 
* [ ] `forget` deletes records; protected/system memories policy remains enforced by the validator layer (unchanged). @src/validators/RefinementActionValidator.ts. 
* [ ] `refine_memories` performs planning with budget gates and validation as described in refinement config. @src/config/refinement.ts and patches in the legacy agent show expected safety behavior.

---

## 16) File‑by‑file carry‑over map (open these for reference while rewriting)

* **Contracts & shared**

  * @src/memory/IMemoryRepository.ts → copy + add `ensureIndex`. 
  * @src/memory/types.ts (domain types). 
  * @src/memory/MemorySearchError.ts. 
  * @src/memory/PriorityCalculator.ts. 
  * @src/memory/postgres/FilterParser.ts. 
  * @src/memory/PoolManager.ts. 

* **Config**

  * @src/config/backend.ts (project registry & active project resolution). 
  * @src/config/embedding.ts (model/dim inference). 
  * @src/config/refinement.ts (budgets, access tracking, query expansion flags). 
  * @src/config/debug.ts (debug categories). 

* **LLM & prompts**

  * @src/llm/LLMClient.ts, @src/llm/EmbeddingService.ts, @src/llm/PromptManager.ts.
  * `prompts/*` and @prompts/README.md for agent composition. 

* **Agent & server**

  * @src/llm/MemoryAgent.ts (remove IndexManager usage in `create_index` and `list_indexes`). 
  * @src/memory/MemoryController.ts. 
  * @src/memory/IndexResolver.ts. 
  * @src/server/MemoryServer.ts (replace the Postgres “not supported” branch with real wiring). 
  * @src/index.ts (stdio bootstrap). 

* **Migrations**

  * @migrations/20250117000001_init_postgres_schema.sql, @migrations/seeds/01_test_data.sql, @migrations/README.md.

---

## 17) Performance guidelines

* Start with `vector(1536)` (text‑embedding‑3‑small). If you change to `3-large`, update both migration and `MEMORY_EMBEDDING_MODEL/MEMORY_EMBEDDING_DIMENSIONS`. The config already covers the mapping and validation. @src/config/embedding.ts. 
* Create an IVFFlat index with a reasonable `lists` value in the migration (kept in the existing SQL). @migrations/20250117000001_init_postgres_schema.sql. 
* Keep `limit` defaults conservative (e.g., 10–50) and add optional `offset` later if needed.

---

## 18) Rollout plan

1. Build & manual seed locally; run `memorize` and `recall` via MCP client.
2. (Optional) Run the old Upstash server side‑by‑side for a day and export/import historical memories if needed (section 13).
3. Switch your MCP client config to point to the new `memory-pg` server binary.

---

## 19) What you will **not** carry over

* Upstash repository and its SDK usage (the entire @src/memory/MemoryRepository.ts path and any Upstash debug categories). 
* File‑based `IndexManager` and `data/indexes.json`. For Postgres, the `memory_indexes` table replaces it. @src/memory/IndexManager.ts existed mainly to bridge Upstash; you can drop it. 
* Integration/unit tests (you’re discarding them now). Re‑introduce minimal smoke tests later.

---

## 20) Acceptance criteria (definition of done)

* MCP server boots with `MEMORY_BACKEND=postgres` and lists tools; no “postgres not yet supported” message. @src/server/MemoryServer.ts. 
* `create_index` → creates row in `memory_indexes` and `list_indexes` shows it (documentCount may be 0). @src/memory/MemoryRepositoryPostgres.ts patterns for listing. 
* `memorize` stores memories, generates embeddings, and returns IDs.
* `recall` returns results ordered by cosine similarity; filter expressions behave as expected via FilterParser. @src/memory/postgres/FilterParser.ts. 
* `forget` removes items; system‑memory protections remain enforced in validator paths as before. @src/validators/RefinementActionValidator.ts. 
* `refine_memories` runs planning and, when not dry‑run, executes allowed actions with budget gating (same config surface). @src/config/refinement.ts. 

---

### Notes tied to the legacy repo you can open for guidance

* **Postgres not yet supported throw** (what you must remove): @src/server/MemoryServer.ts. 
* **Postgres repository SQL patterns** (DB info, list indexes, id resolution): @src/memory/MemoryRepositoryPostgres.ts. 
* **Embedding model/dim config**: @src/config/embedding.ts and @src/llm/EmbeddingService.ts.
* **Filter grammar**: @src/memory/postgres/FilterParser.ts. 
* **Agent tool wiring and return payloads**: @src/llm/MemoryAgent.ts (see create/list index, scan paths).
* **Controller contract**: @src/memory/MemoryController.ts. 
* **Migrations overview**: @migrations/README.md. 

This specification gives you a clean, file‑by‑file rebuild path that keeps the strong parts of the legacy design (agent, prompts, contracts) and eliminates Upstash dependencies, JSON index registry, and accumulated complexity.
