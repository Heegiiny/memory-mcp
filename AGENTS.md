# Repository Guidelines

## Modifications from Original (memory-mcp fork)

This fork is modified for local Ollama deployment. Key changes:

### Local model support (Ollama / LiteLLM)

- **MemoryServer.ts**: `OPENAI_API_BASE` / `OPENAI_BASE_URL` support; API key optional when using base URL (`OPENAI_API_KEY=ollama`).
- **LLMClient.ts**: `baseURL` parameter; when set, uses Chat Completions API instead of Responses API for better tool calling with Ollama.
- **EmbeddingService.ts**: `baseURL` parameter for embedding endpoint.
- **.env.example**: Added comments for local setup (`OPENAI_API_BASE`, `OPENAI_API_KEY=ollama`).

### Embedding models

- **embedding.ts**: Added `nomic-embed-text` (768) and `bge-m3` (1024). Set `MEMORY_EMBEDDING_MODEL` and `MEMORY_EMBEDDING_DIMENSIONS` accordingly.
- **migrations/20250211000000_bge_m3_1024_vectors.sql**: Migration to switch `memories.embedding` from 1536 to 1024 dimensions (run on empty DB or via reset-and-migrate).

### Memorize operation robustness

- **MemorizeOperation.ts**: Fallback direct upsert when user explicitly says "remember", "запомни", "memorize", "store", "save" and agent stored nothing (avoids LLM ignoring explicit requests).
- **MemorizeOperation.ts**: If LLM response is not valid JSON (common with local models), uses empty result instead of throwing.
- **utils.ts**: `safeJsonParse` tries `extractJsonFromText` first (handles markdown-style JSON blocks and raw `{...}`) for models that return prose around JSON.
- **MemoryServer.ts**: Updated memorize tool description suggesting "Remember: " / "Memorize: " prefix for reliable storage.

### Prompts

- **memory-base.txt**: Expanded with proactive memory philosophy, "What Makes Information Memorable", semantic types.
- **memory-memorize.txt**, **memory-analyzer.txt**: Adjusted for richer metadata and local model behavior.

### Scripts

- **scripts/reset-and-migrate.ts**: Full DB reset + migration (useful when switching embedding dimensions).

---

## MCP Tools (Exposed to Host)

| Tool                  | Purpose                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **memorize**          | Store memories from text or files. Input: `input`, optional `files`, `index`, `metadata`, `projectSystemMessagePath`.                                     |
| **recall**            | Search + synthesize. Input: `query`, optional `limit`, `filters`, `filterExpression`, `responseMode` (answer/memories/both), `enableReconsolidation`.     |
| **forget**            | Plan or execute deletions. Input: `input`, optional `filters`, `dryRun` (default true), `explicitMemoryIds`.                                              |
| **refine_memories**   | Curate: dedupe, reprioritize, summarize. Operation: consolidation/decay/cleanup/reflection. Scope: `query`, `filters`, `seedIds`, `maxCandidates`.        |
| **create_index**      | Create/ensure index. Input: `name`, optional `description`.                                                                                               |
| **list_indexes**      | List indexes with document counts.                                                                                                                        |
| **scan_memories**     | Direct Postgres search (no LLM). Input: `query`, optional `limit`, `filters`, `filterExpression`, `semanticWeight`, `reranking`, `includeMetadata`.       |
| **inspect_character** | Developer inspection. Input: `index`, `view` (type_distribution, top_beliefs, emotion_map, relationship_graph, priority_health), optional limits/filters. |

## Internal Agent Tools (LLM-only)

- **search_memories** — Semantic search
- **get_memories** — Fetch by ID (relationship traversal)
- **upsert_memories** — Store/update
- **delete_memories** — Remove (disabled in forget-dryrun and refinement-planning)
- **read_file** — Read project files (sandboxed)
- **analyze_text** — Extract metadata/facts via analysis model

## Features & Behavior

### Filter grammar (recall, forget, refine, scan)

- Operators: `=`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `CONTAINS`
- Field access: `@id`, `@metadata.fieldName`
- Logic: `AND`, `OR`, parentheses
- Example: `@metadata.tags CONTAINS "work" AND @metadata.importance > 0.5`

### Access tracking & priority

- Search/recall updates `accessCount`, `lastAccessedAt` (fire-and-forget)
- Priority: recency × 0.4 + importance × 0.4 + usage × 0.2, clamped [0.0, 1.0]
- Env: `MEMORY_ACCESS_TRACKING_ENABLED`, `MEMORY_ACCESS_TRACKING_TOP_N`, `MEMORY_ACCESS_PRIORITY_BOOST`

### Query expansion (recall)

- Optional: generate alternative phrasings for semantic search
- Env: `MEMORY_QUERY_EXPANSION_ENABLED`, `MEMORY_QUERY_EXPANSION_COUNT`

### Reconsolidation (recall)

- `enableReconsolidation: true`: after synthesis, agent may create derived memories, mark supersessions, increment sleep cycles

### Refinement operations

- **consolidation** — Merge duplicates, add summaries
- **decay** — Apply priority decay
- **cleanup** — Remove low-priority/obsolete
- **reflection** — Episodic → belief/summary conversion

### Character memory (inspect_character)

- Views: `type_distribution`, `top_beliefs`, `emotion_map`, `relationship_graph`, `priority_health`
- Uses `metadata.memoryType`, `metadata.emotion`, `memory_relationships`

### Ingestion (memorize + files)

- Chunking: `MEMORY_CHUNK_CHAR_LENGTH` (16000), `MEMORY_CHUNK_CHAR_OVERLAP` (2000)
- Limits: `MEMORY_LARGE_FILE_THRESHOLD_BYTES`, `MEMORY_MAX_CHUNKS_PER_FILE`, `MEMORY_MAX_MEMORIES_PER_FILE`
- File paths: sandboxed via `ProjectFileLoader`, respect `MEMORY_MAX_FILE_BYTES`

### Debug env vars

- `MEMORY_DEBUG_MODE`, `MEMORY_DEBUG_OPERATIONS`, `MEMORY_DEBUG_VALIDATION`, `MEMORY_DEBUG_ACCESS_TRACKING`, `MEMORY_DEBUG_REPOSITORY`, `MEMORY_DEBUG_QUERY_EXPANSION`

---

## Project Structure & Module Organization

- `src/server` exposes the MCP tools and wires transports, configs, and controllers.
- `src/memory`, `src/llm`, and `src/validators` hold repository logic, agent orchestration, and input guards.
- Prompts live in `prompts/` with mode-specific templates; migrations and scripts are under `migrations/` and `scripts/`.
- Configuration files are JSON/TOML-style under `config/`, while build tooling sits at the root (`tsconfig.json`, `eslint.config.js`).

## Build, Test, and Development Commands

- `npm run dev` starts the MCP server with hot reload (`tsx src/index.ts`).
- `npm run build` compiles TypeScript into `dist/`; run `npm start` to execute the compiled build.
- `npm run lint`, `npm run lint:fix`, and `npm run format` enforce style; run before committing.
- Database helpers: `npm run migrate`, `npm run migrate:seed`, and `npm run migrate:verify` run Postgres migrations via `scripts/run-migrations.ts`; `scripts/setup-postgres.sh` provisions pgvector locally.

## Coding Style & Naming Conventions

- TypeScript everywhere (ES2022 target, ESM); prefer explicit exports and descriptive module names mirroring directories.
- Follow Prettier defaults (2-space indent, single quotes) and ESLint rules specified in `eslint.config.js`.
- Use camelCase for variables/functions, PascalCase for classes, and suffix files by role (e.g., `MemoryController.ts`).
- Keep new prompts and config entries ASCII unless an existing file already contains Unicode.

## Testing Guidelines

- The project uses Jest for unit/integration tests and tsx for targeted test suites; run `npm test`, `npm run lint`, and `npm run build` as the minimum validation gate.
- Test commands: `npm test` (Jest suite), `npm run test:coverage` (coverage report), `npm run test:indexes`, `npm run test:memorize`, `npm run test:scan` (tsx-based targeted tests).
- When adding tests, place them beside source files (`*.test.ts`) and wire them into npm scripts before merging.
- Validate database-facing changes with `npm run migrate:verify` against a local Postgres instance.

## Commit & Pull Request Guidelines

- Use concise, imperative commit messages (e.g., `Add pgvector access tracking`) and group related changes.
- Run `npm run format` (or `lint:fix`) before committing; never revert user changes in the working tree.
- PRs should describe intent, reference tasks/issues, and note database or prompt updates; include steps to reproduce or validate when relevant.

## Security & Configuration Tips

- Set `MEMORY_POSTGRES_PROJECT_REGISTRY`, `MEMORY_ACTIVE_PROJECT`, and `OPENAI_API_KEY` locally; never commit secrets.
- When changing embedding models, update both env vars and migration schema (`vector(dimensions)`).
- Use `ProjectFileLoader` safeguards when ingesting files; respect `MEMORY_MAX_FILE_BYTES` to avoid large payload failures.

## Imperfect Memory Goals

- Align architectural or prompt changes with the simulation principles captured in `docs/SIMULATED_BRAIN.md`, which explains how we map cognitive concepts (decay, reinforcement, reconstruction, interference) onto the MCP.
