# Memory MCP Server (Modified Fork)

> **Модифицированный форк** — адаптация для локального стека Ollama (Qwen3 8B + BGE-M3). Оригинал: [modelcontextprotocol/memory-mcp](https://github.com/modelcontextprotocol/memory-mcp)

Model Context Protocol (MCP) сервер семантической памяти на PostgreSQL + pgvector. LLM‑агент управляет операциями через natural language. **Эта версия** рассчитана на развёртывание на соседнем ПК с Ollama и общим PostgreSQL.

## Overview

Сервер позволяет ИИ‑ассистентам хранить, искать и управлять долговременной памятью. Использует векторный поиск (pgvector) и LLM для интерпретации запросов.

### Key Features

- **Локальный стек**: Ollama (LLM), BGE-M3 (эмбеддинги), PostgreSQL + pgvector (хранилище)
- **Agentic Architecture**: LLM управляет операциями через внутренние инструменты
- **Semantic Search**: гибридный поиск (вектор + keyword)
- **Dynamic Priority**: приоритеты памяти decay/boost по использованию
- **Rich Metadata**: топики, теги, типы памяти (self, belief, episodic и др.)
- **Memory Lifecycle**: consolidation, deduplication, refinement

## Развёртывание на соседнем компьютере

Ниже — пошаговая инструкция, чтобы развернуть **точно такой же** сервер на другом ПК и подключить Claude + Cursor.

### Требования

| Компонент      | Где                 | Пример                     |
| -------------- | ------------------- | -------------------------- |
| PostgreSQL 14+ | Локально/сеть       | `192.168.1.45:5432`        |
| pgvector       | В Postgres          | `CREATE EXTENSION vector;` |
| Ollama         | Локально/сеть       | `192.168.1.80:11434`       |
| Node.js 18+    | Где запускается MCP | Обычно локально            |

### 1. Клонировать и установить зависимости

```bash
git clone <URL-вашего-форка>
cd memory-mcp
npm install
npm run build
```

### 2. PostgreSQL (локально или на соседнем ПК)

Создать БД и включить pgvector — затем в шаге 3 запустить `reset-and-migrate`.

**PostgreSQL на другом ПК** (например `192.168.1.45`):

```bash
# На сервере с PostgreSQL
psql -U postgres -c "CREATE DATABASE mcp_memory;"
psql -U postgres -d mcp_memory -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

**PostgreSQL локально**:

```bash
# Linux/macOS
createdb mcp_memory
psql -d mcp_memory -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Или: ./scripts/setup-postgres.sh (создаст memory_default — тогда в DATABASE_URL укажите memory_default)
```

### 3. Миграция под BGE-M3 (1024 измерения)

`reset-and-migrate.ts` уже включает миграцию на 1024 измерения. Запуск:

```powershell
# PowerShell
$env:DATABASE_URL="postgresql://user:pass@host:5432/mcp_memory"
npx tsx scripts/reset-and-migrate.ts
```

```bash
# Bash
DATABASE_URL=postgresql://user:pass@host:5432/mcp_memory npx tsx scripts/reset-and-migrate.ts
```

**Внимание**: все данные в таблицах памяти будут удалены.

### 4. Конфигурация (.env)

```env
# PostgreSQL (соседний ПК или localhost)
DATABASE_URL=postgresql://mcp_user:password@192.168.1.45:5432/mcp_memory

# Ollama (соседний ПК или localhost)
OPENAI_API_BASE=http://192.168.1.80:11434/v1
OPENAI_API_KEY=ollama

# LLM
MEMORY_MODEL=qwen3:8b
MEMORY_ANALYSIS_MODEL=qwen3:8b

# Эмбеддинги BGE-M3
MEMORY_EMBEDDING_MODEL=bge-m3
MEMORY_EMBEDDING_DIMENSIONS=1024
```

Перед первым запуском: `ollama pull qwen3:8b` и `ollama pull bge-m3` на машине с Ollama.

### 5. Проверка

```bash
npm run dev
```

Сервер должен запуститься и слушать STDIO. Тест: `npm run health`.

### 6. Подключение Claude Desktop

Файл конфигурации:

- **Windows**: `C:\Users\<ИМЯ>\AppData\Roaming\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Добавить в `mcpServers`:

```json
{
  "mcpServers": {
    "memory-mcp": {
      "command": "cmd.exe",
      "args": ["/c", "cd /d C:\\path\\to\\memory-mcp && npx tsx src/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://mcp_user:password@192.168.1.45:5432/mcp_memory",
        "OPENAI_API_BASE": "http://192.168.1.80:11434/v1",
        "OPENAI_API_KEY": "ollama",
        "MEMORY_EMBEDDING_MODEL": "bge-m3",
        "MEMORY_EMBEDDING_DIMENSIONS": "1024",
        "MEMORY_MODEL": "qwen3:8b",
        "MEMORY_ANALYSIS_MODEL": "qwen3:8b"
      }
    }
  }
}
```

**Важно**: замените `C:\\path\\to\\memory-mcp` на фактический путь к папке проекта. После правок перезапустите Claude Desktop.

### 7. Подключение Cursor

Файл конфигурации:

- **Windows**: `C:\Users\<ИМЯ>\.cursor\mcp.json`

```json
{
  "mcpServers": {
    "memory-mcp": {
      "command": "cmd.exe",
      "args": ["/c", "cd /d C:\\path\\to\\memory-mcp && npx tsx src/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://mcp_user:password@192.168.1.45:5432/mcp_memory",
        "OPENAI_API_BASE": "http://192.168.1.80:11434/v1",
        "OPENAI_API_KEY": "ollama",
        "MEMORY_EMBEDDING_MODEL": "bge-m3",
        "MEMORY_EMBEDDING_DIMENSIONS": "1024",
        "MEMORY_MODEL": "qwen3:8b",
        "MEMORY_ANALYSIS_MODEL": "qwen3:8b"
      }
    }
  }
}
```

Перезапустите Cursor после изменений.

### Альтернатива: production build

```bash
npm run build
```

И в конфиге вместо `npx tsx src/index.ts` укажите:

```
"args": ["/c", "cd /d C:\\path\\to\\memory-mcp && node dist/index.js"]
```

## Architecture

The Memory MCP server uses a layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│  MCP Layer (MemoryServer.ts)                                    │
│  • MCP tools: memorize, recall, forget, refine_memories,        │
│    create_index, list_indexes, scan_memories                    │
│  • STDIO transport for Claude Desktop integration               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Controller Layer (MemoryController.ts)                         │
│  • Security boundaries (ProjectFileLoader, IndexResolver)       │
│  • Index access validation                                      │
│  • Routes tool calls to agent modes                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Agent Layer (MemoryAgent.ts)                                   │
│  • LLM orchestration (GPT-4/5) with mode-specific prompts       │
│  • Tool Runtime: search_memories, get_memories,                 │
│    upsert_memories, delete_memories, read_file,                 │
│    analyze_text, list_relationships                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Repository Layer (MemoryRepositoryPostgres.ts)                 │
│  • PostgreSQL + pgvector data access                            │
│  • Embedding generation, semantic search                        │
│  • Access tracking, relationship management                     │
│  • Connection pooling per project (PoolManager.ts)              │
└─────────────────────────────────────────────────────────────────┘
```

### Supporting Components

- **PromptManager**: Composes base + mode-specific + host/project context into system messages
- **IndexResolver**: Validates index names and provides default index logic
- **ProjectFileLoader**: Securely loads files from project directory with size limits
- **PriorityCalculator**: Deterministic priority formula (recency × 0.4 + importance × 0.4 + usage × 0.2)

## Prerequisites

- **PostgreSQL 14+** — с поддержкой pgvector
- **pgvector** — `CREATE EXTENSION vector;`
- **Node.js 18+**
- **Ollama** — для LLM и эмбеддингов (локально или на соседнем ПК)

## Configuration

Сервер читает настройки из переменных окружения (через `.env` или `env` в конфиге MCP).

### Обязательные переменные

```env
# PostgreSQL
DATABASE_URL=postgresql://user:password@host:5432/database

# Ollama (заменить host на IP, если Ollama на другом ПК)
OPENAI_API_BASE=http://192.168.1.80:11434/v1
OPENAI_API_KEY=ollama

# Эмбеддинги BGE-M3
MEMORY_EMBEDDING_MODEL=bge-m3
MEMORY_EMBEDDING_DIMENSIONS=1024

# LLM
MEMORY_MODEL=qwen3:8b
MEMORY_ANALYSIS_MODEL=qwen3:8b
```

### Дополнительные переменные

```env
# Опционально
MEMORY_MCP_SYSTEM_MESSAGE=./config/memory-host-context.txt
MEMORY_DEBUG_MODE=true
MEMORY_ACCESS_TRACKING_ENABLED=true
MEMORY_QUERY_EXPANSION_ENABLED=true
MEMORY_REFINE_DEFAULT_BUDGET=100
```

### Поддерживаемые модели эмбеддингов

| Модель                   | Размерность | Примечание            |
| ------------------------ | ----------- | --------------------- |
| `text-embedding-3-small` | 1536        | OpenAI                |
| `text-embedding-3-large` | 3072        | OpenAI                |
| `bge-m3`                 | 1024        | Ollama, рекомендуется |
| `nomic-embed-text`       | 768         | Ollama                |

**Важно**: размерность `embedding` в БД должна совпадать с моделью. Для BGE-M3 используйте миграцию `20250211000000_bge_m3_1024_vectors.sql` или `reset-and-migrate.ts`.

### Host Context (опционально)

`MEMORY_MCP_SYSTEM_MESSAGE` — путь к файлу или inline-текст с контекстом для промптов. `projectSystemMessagePath` в вызовах инструментов — контекст на операцию. См. `prompts/README.md`.

## Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

This starts the MCP server in development mode with hot reload (uses `tsx`).

### Build for Production

```bash
npm run build
npm start
```

The `build` command compiles TypeScript to `dist/`, and `start` runs the compiled server.

### Code Quality

```bash
# Check linting
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check if code is formatted
npm run format:check
```

**Always run `npm run format` or `npm run lint:fix` before committing** to maintain code consistency.

## Usage

The Memory MCP server exposes tools through the Model Context Protocol. These tools are typically called from Claude Desktop or other MCP-compatible clients.

### How MCP Tools Work

MCP tools are called through MCP-compatible clients like Claude Desktop. When you interact with Claude, you can reference memories naturally in conversation, and Claude will use these tools automatically. The tools can also be called programmatically through the MCP protocol using JSON payloads as shown in the examples below.

**Example conversational usage in Claude Desktop:**

- "Remember that I prefer dark mode" → uses `memorize` tool
- "What are my notification preferences?" → uses `recall` tool
- "Forget my old email address" → uses `forget` tool

### Tool: `memorize`

**Purpose**: Capture durable memories from free-form text or files. The agent extracts atomic facts, enriches them with metadata (topic, tags, memoryType), and stores them in PostgreSQL + pgvector.

**Parameters**:

- `input` (required): Natural language instruction describing what to memorize
- `files` (optional): Array of relative file paths to ingest alongside the instruction
- `index` (optional): Index name (defaults to `MEMORY_DEFAULT_INDEX`)
- `projectSystemMessagePath` (optional): Relative path to project-specific system message
- `metadata` (optional): Additional metadata to apply to extracted memories

**Example**:

```json
{
  "input": "Remember that the user prefers dark mode and wants notifications disabled after 9 PM",
  "metadata": {
    "category": "user_preferences"
  }
}
```

**With file ingestion**:

```json
{
  "input": "Memorize the key design decisions from this architecture document",
  "files": ["docs/architecture.md"],
  "index": "project_knowledge"
}
```

**Behavior**:

- Breaks down complex information into atomic, searchable memories
- Automatically extracts topics, tags, and classifies memory types (self, belief, pattern, episodic, semantic)
- For large files, uses chunking and GPT-4-mini for fast pre-processing via `analyze_text` tool
- Returns summary of memories created with IDs and metadata

### Tool: `recall`

**Purpose**: Search stored memories and optionally synthesize an answer. Supports metadata filters, returning raw memories, and priority-aware synthesis.

**Parameters**:

- `query` (required): Natural language question or topic to search for
- `index` (optional): Index name override
- `limit` (optional): Maximum number of memories to return (default: 10)
- `filters` (optional): Structured metadata filters (keys match stored metadata)
- `filterExpression` (optional): Advanced filter expression using filter DSL
- `projectSystemMessagePath` (optional): Project-specific system message path
- `responseMode` (optional): `"answer"` (synthesized), `"memories"` (raw), or `"both"` (default: `"answer"`)

**Example - Synthesized answer**:

```json
{
  "query": "What are the user's notification preferences?",
  "responseMode": "answer"
}
```

**Example - Raw memories with filters**:

```json
{
  "query": "design decisions",
  "filters": {
    "category": "architecture"
  },
  "responseMode": "memories",
  "limit": 20
}
```

**Example - Advanced filter expression**:

```json
{
  "query": "recent work tasks",
  "filterExpression": "@metadata.tags contains \"work\" AND @metadata.priority > 0.7",
  "responseMode": "both"
}
```

**Behavior**:

- Uses semantic search (pgvector) + keyword search for hybrid retrieval
- Priority-aware synthesis privileges high-salience memories
- Automatic access tracking updates memory priority and access counts
- Returns synthesized answers and/or raw memory records with metadata

### Tool: `forget`

**Purpose**: Plan deletions with the LLM agent. Supports dry runs, metadata-scoped deletes, and explicit ID deletion.

**Parameters**:

- `input` (required): Instruction describing what to forget
- `index` (optional): Index override
- `filters` (optional): Metadata filters for narrowing deletion candidates
- `projectSystemMessagePath` (optional): System message path for contextualizing deletions
- `dryRun` (optional): Default `true`; when `false` the agent executes approved deletes
- `explicitMemoryIds` (optional): Array of specific memory IDs to delete immediately

**Example - Dry run (default)**:

```json
{
  "input": "Forget all memories about the old API design that was replaced in December",
  "dryRun": true
}
```

**Example - Execute deletion with filters**:

```json
{
  "input": "Delete all low-priority temporary notes",
  "filters": {
    "memoryType": "episodic",
    "category": "temp"
  },
  "dryRun": false
}
```

**Example - Delete specific IDs**:

```json
{
  "input": "Remove these obsolete memories",
  "explicitMemoryIds": ["550e8400-e29b-41d4-a716-446655440000"],
  "dryRun": false
}
```

**Behavior**:

- Conservative deletion with dry-run protection (default)
- Agent searches for matching memories and explains what would be deleted
- Validates against safety rules (e.g., can't delete system memories)
- When `dryRun=false`, executes approved deletions
- Returns list of deleted memories with rationale

### Tool: `refine_memories`

**Purpose**: Curate stored memories through consolidation, deduplication, reprioritization, and cleanup. The agent analyzes memories and generates structured refinement plans.

**Parameters**:

- `index` (optional): Index override
- `operation` (optional): Refinement mode - `"consolidation"`, `"decay"`, `"cleanup"`, or `"reflection"`
- `scope` (optional): Controls which memories are considered
  - `query`: Semantic query to find candidates
  - `filters`: Metadata filters
  - `seedIds`: Array of specific memory IDs to start from
  - `maxCandidates`: Maximum memories to analyze
- `budget` (optional): Maximum actions to execute (default from `MEMORY_REFINE_DEFAULT_BUDGET`)
- `dryRun` (optional): Plan-only mode when `true` (default)
- `projectSystemMessagePath` (optional): Project-specific context

**Example - Consolidation**:

```json
{
  "operation": "consolidation",
  "scope": {
    "query": "user preferences",
    "maxCandidates": 50
  },
  "dryRun": true
}
```

**Example - Decay (reprioritization)**:

```json
{
  "operation": "decay",
  "budget": 100,
  "dryRun": false
}
```

**Example - Cleanup with filters**:

```json
{
  "operation": "cleanup",
  "scope": {
    "filters": {
      "memoryType": "episodic"
    }
  },
  "dryRun": true
}
```

**Operation Modes**:

- **Consolidation**: Merge duplicates, create summaries, detect contradictions, link related memories
- **Decay**: Reprioritize memories using deterministic priority formula based on recency, usage, and importance
- **Cleanup**: Identify deletion candidates (low priority, superseded, obsolete) as dry-run recommendations
- **Reflection**: Generate high-level summaries and patterns from related memories

**Action Types**:

- `UPDATE`: Reprioritize or add relationships between memories
- `MERGE`: Consolidate duplicate or redundant memories
- `CREATE`: Generate summary memories from multiple related memories
- `DELETE`: Remove obsolete or low-priority memories (recommendations only in dry-run)

**Behavior**:

- Agent uses GPT-4/5 for complex pattern analysis and planning
- Generates structured refinement actions with rationale
- Validates actions against safety rules (e.g., can't delete system memories)
- Returns refinement plan with actions and expected outcomes
- When `dryRun=false`, executes approved actions

### Tool: `create_index`

**Purpose**: Create or ensure a PostgreSQL-backed memory index exists for the active project.

**Parameters**:

- `name` (required): New index name
- `description` (optional): Human description stored alongside the index record

**Example**:

```json
{
  "name": "work_notes",
  "description": "Professional work-related notes and decisions"
}
```

**Behavior**:

- Creates a new index if it doesn't exist
- If index already exists, returns existing index information
- Indexes are stored as rows in the `memory_indexes` table
- Each project can have multiple indexes for logical organization

### Tool: `list_indexes`

**Purpose**: List all PostgreSQL memory indexes with document counts so agents can choose destinations.

**Parameters**: None

**Example**:

```json
{}
```

**Returns**:

```json
{
  "indexes": [
    {
      "name": "personal",
      "documentCount": 142,
      "pendingDocumentCount": 0,
      "project": "local"
    },
    {
      "name": "work_notes",
      "documentCount": 87,
      "pendingDocumentCount": 0,
      "project": "local"
    }
  ],
  "totalMemories": 229,
  "totalDiskBytes": 1048576
}
```

**Behavior**:

- Returns all indexes for the active project
- Includes document counts for each index (pendingDocumentCount always 0 in PostgreSQL backend)
- Provides aggregate statistics (totalMemories, totalDiskBytes)
- Helps agents choose appropriate index for new memories
- Useful for understanding memory organization

### Tool: `scan_memories`

**Purpose**: Run direct PostgreSQL searches without LLM orchestration. Returns raw results and diagnostics for debugging and inspection.

**Parameters**:

- `query` (required): Search query text
- `index` (optional): Index override
- `limit` (optional): Max results (default 10, max 1000)
- `filters` (optional): Structured metadata filters
- `filterExpression` (optional): Advanced filter expression string
- `semanticWeight` (optional): Semantic vs keyword weighting (0-1)
- `reranking` (optional): Enable reranking (default true)
- `includeMetadata` (optional): Include metadata payloads (default true)

**Example**:

```json
{
  "query": "user preferences",
  "limit": 20,
  "semanticWeight": 0.7,
  "includeMetadata": true
}
```

**Behavior**:

- Bypasses LLM agent and queries PostgreSQL directly
- Useful for debugging search quality and inspecting raw embeddings
- Returns raw search results with similarity scores
- Includes diagnostics about query execution
- Not typically used in normal operation (use `recall` instead for LLM-synthesized answers)

## Troubleshooting

### pgvector extension not found

**Error**: `ERROR: extension "vector" is not available`

**Solution**:

```bash
# Verify pgvector is installed
pg_config --sharedir
# Check if vector.control exists in <sharedir>/extension/

# Reinstall if needed (macOS)
brew reinstall pgvector

# Reinstall if needed (Linux)
cd pgvector && sudo make install
```

### Cannot connect to database

**Error**: `Error: connect ECONNREFUSED` or `FATAL: password authentication failed`

**Solution**:

```bash
# Проверить, что PostgreSQL запущен
psql -U postgres -l

# Проверить DATABASE_URL — пользователь, пароль, хост, порт, БД

# Тест подключения
psql "postgresql://user:pass@host:5432/mcp_memory"
```

### Permission denied for CREATE EXTENSION

**Error**: `ERROR: permission denied to create extension "vector"`

**Solution**:

```bash
# Connect as superuser (usually postgres)
psql -U postgres -d memory_default -c "CREATE EXTENSION vector;"
```

### Embedding dimension mismatch

**Error**: `Embedding dimension mismatch: expected 1024, got 1536`

**Причина**: БД с `vector(1536)`, а модель (bge-m3) выдаёт 1024.

**Решение**:

```bash
# Сброс схемы + миграции (данные удалятся)
DATABASE_URL=postgresql://... npx tsx scripts/reset-and-migrate.ts
psql "$DATABASE_URL" -f migrations/20250211000000_bge_m3_1024_vectors.sql
```

### Missing API key / base URL

**Error**: `OPENAI_API_KEY is required (or set OPENAI_API_BASE for local models, then OPENAI_API_KEY=ollama).`

**Solution**:

Для Ollama задайте оба параметра:

```env
OPENAI_API_BASE=http://localhost:11434/v1
OPENAI_API_KEY=ollama
```

### Memory index not found

**Error**: `Error: Index not found`

**Solution**:

1. List available indexes: Call `list_indexes` tool
2. Create the index: Call `create_index` tool with the desired name
3. Check `MEMORY_DEFAULT_INDEX` environment variable matches an existing index

### Server won't start - relation 'memories' does not exist

**Ошибка**: `relation "memories" does not exist` или `relation "memory_indexes" does not exist`

**Причина**: Миграции не выполнены.

**Решение**:

```bash
# Вариант 1: Полный сброс + миграции (включая BGE-M3)
DATABASE_URL=postgresql://... npx tsx scripts/reset-and-migrate.ts

# Вариант 2: Только миграции (если БД пустая)
npm run migrate
```

### Server won't start - missing dependencies

**Error**: `Cannot find module '@modelcontextprotocol/sdk'` or similar import errors

**Solution**:

```bash
# Install all dependencies
npm install

# Verify installation
npm list @modelcontextprotocol/sdk
```

### Claude Desktop / Cursor не подключаются к MCP

**Ошибка**: `Cannot connect to server on stdio` или сервер не отвечает

**Решение**:

1. Запустите вручную: `cd memory-mcp && npx tsx src/index.ts` — ошибок быть не должно.
2. Проверьте путь в конфиге (абсолютный, с правильными слэшами).
3. **Claude** — `C:\Users\<ИМЯ>\AppData\Roaming\Claude\claude_desktop_config.json`
4. **Cursor** — `C:\Users\<ИМЯ>\.cursor\mcp.json`
5. Все переменные `env` (DATABASE_URL, OPENAI_API_BASE, MEMORY_EMBEDDING_MODEL и т.д.) должны быть заданы в конфиге MCP.
6. Перезапустите Claude Desktop / Cursor после изменений.

### Development server errors

**Error**: Various TypeScript or runtime errors during `npm run dev`

**Solution**:

```bash
# Clear any caches and reinstall
rm -rf node_modules package-lock.json
npm install

# Run linting and formatting
npm run lint:fix
npm run format

# Check TypeScript compilation
npm run build
```

## Cloud Deployment

### Neon

[Neon](https://neon.tech) provides serverless PostgreSQL with pgvector support:

1. Create a new project at [console.neon.tech](https://console.neon.tech)
2. Enable pgvector in the SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Run the schema migration:
   ```sql
   -- Copy contents of migrations/20250117000001_init_postgres_schema.sql
   ```
4. Copy the connection string to `config/projects.json`:
   ```json
   {
     "production": {
       "databaseUrl": "postgresql://user:password@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
     }
   }
   ```

### Supabase

[Supabase](https://supabase.com) includes pgvector by default:

1. Create a new project at [app.supabase.com](https://app.supabase.com)
2. Go to SQL Editor and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Run the schema migration in the SQL Editor
4. Copy the connection string from Project Settings → Database:
   ```json
   {
     "production": {
       "databaseUrl": "postgresql://postgres:your-password@db.xxxxxxxxxxxx.supabase.co:5432/postgres"
     }
   }
   ```

### Other PostgreSQL Providers

Any PostgreSQL 14+ provider with pgvector support will work:

- AWS RDS for PostgreSQL (with pgvector extension)
- Google Cloud SQL for PostgreSQL
- Azure Database for PostgreSQL
- DigitalOcean Managed Databases
- Self-hosted PostgreSQL instances

## Additional Documentation

- **[docs/CHARACTER_MEMORY.md](docs/CHARACTER_MEMORY.md)** - Design principles for AI characters and imperfect memory behavior
- **[docs/SIMULATED_BRAIN.md](docs/SIMULATED_BRAIN.md)** - How the memory system simulates human-like cognition with decay, consolidation, and spreading activation
- **[docs/BACKDATING_GUIDE.md](docs/BACKDATING_GUIDE.md)** - Comprehensive guide for historical memory ingestion with priority decay calculations and practical examples
- **[migrations/20250117000001_init_postgres_schema.sql](migrations/20250117000001_init_postgres_schema.sql)** - Database schema and migration
- **[scripts/setup-postgres.sh](scripts/setup-postgres.sh)** - Automated setup script
- **[CLAUDE.md](CLAUDE.md)** - Developer guidance for working with this codebase
- **[prompts/README.md](prompts/README.md)** - Composable prompt system documentation

## License

Private - Internal use only
