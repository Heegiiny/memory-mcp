# Backdating Guide for Historical Memory Ingestion

> **Version:** 1.0
> **Last Updated:** 2025-11-18

## Overview

When building character backgrounds from existing content—old blog posts, YouTube scripts, archived emails, project notes—timestamps play a crucial role in creating **temporally coherent memories** that feel authentic and integrate properly with the character's evolving timeline.

By default, all memories are created with today's timestamp. This causes incorrect priority calculations and prevents accurate representation of how your character's knowledge accumulated over time. This guide explains when and how to use backdating to create historically accurate memory profiles.

## Table of Contents

1. [Timestamp vs. metadata.date](#timestamp-vs-metadatadate)
2. [How Priority Decay Works](#how-priority-decay-works)
3. [Priority Decay Tables by Memory Type](#priority-decay-tables-by-memory-type)
4. [Practical Examples](#practical-examples)
5. [Workflows and Patterns](#workflows-and-patterns)
6. [Interactions with Other Features](#interactions-with-other-features)
7. [Best Practices](#best-practices)

## Timestamp vs. metadata.date

### Quick Reference

| Field               | Purpose                                    | Format     | Controls                                   |
| ------------------- | ------------------------------------------ | ---------- | ------------------------------------------ |
| `content.timestamp` | **Storage time** — controls priority decay | ISO 8601   | How fast the memory fades over time        |
| `metadata.date`     | **Reference date** — semantic context      | YYYY-MM-DD | Human-readable meaning, no impact on decay |

### Detailed Explanation

#### `content.timestamp` — The Decay Driver

The **timestamp** is the system-critical field that determines how a memory's priority decays over time. When you backdate a memory, you set this field to the original creation date.

**Purpose:**

- Controls the recency component of the priority formula
- Simulates how human memory naturally fades over time
- Ensures old episodic memories don't compete with recent ones
- Allows core beliefs to remain stable regardless of age

**Format Options:**

- **Full datetime (preferred):** `"2025-02-04T10:00:00Z"` — precise to the second
- **Date only:** `"2025-02-04"` — defaults to midnight UTC when time is unknown

**Example — YouTube Video Import:**

```json
{
  "text": "Script about productivity hacks from episode #42",
  "metadata": {
    "topic": "personal-development",
    "importance": "medium"
  },
  "timestamp": "2025-02-04T14:30:00Z" // Original upload time
}
```

#### `metadata.date` — The Reference Date

The **metadata.date** field stores a human-readable date for context. It does **not** affect priority decay and is purely informational. Use this field when the date is important for understanding the memory's meaning but differs from the creation date.

**Purpose:**

- Filters and searches (e.g., "memories from 2024")
- Semantic context (e.g., "This video discusses the 2020 Olympics")
- Relationship tracking (e.g., "learned this technique in 2022")

**Format:** `YYYY-MM-DD`

**Example — Historical Event Memory:**

```json
{
  "text": "Witnessed the 2020 Olympics closing ceremony",
  "metadata": {
    "date": "2020-08-09", // When the event occurred
    "topic": "events"
  },
  "timestamp": "2025-02-15T10:00:00Z" // When I ingested this memory (today)
}
```

In this case:

- The memory was **created today** (for sorting, decay calculation)
- But it **references** August 2020 (for semantic understanding)
- Search filters can use `@metadata.date` to find memories from specific periods

### Side-by-Side Comparison

**Scenario:** Character building from a blog that ran from 2022–2025

```json
// Approach A: Accurate Temporal History
{
  "text": "Launched personal blog with article about remote work",
  "metadata": {
    "date": "2022-03-15",      // When the blog launched
    "source": "blog-archive"
  },
  "timestamp": "2022-03-15T09:00:00Z"  // Backdate to March 2022
}
// Result: Memory decays naturally as if ingested 3 years ago
//         Reflects character's actual learning timeline

// Approach B: Current Ingestion Date
{
  "text": "Launched personal blog with article about remote work",
  "metadata": {
    "date": "2022-03-15",      // Original date preserved
    "source": "blog-archive"
  },
  "timestamp": "2025-11-18T10:00:00Z"  // Today's date (no backdating)
}
// Result: Memory has high priority despite being 3 years old
//         Feels like the character just remembered this (unnatural)
```

**Recommendation:** Use Approach A (accurate timestamp) for character backgrounds to create realistic priority decay and temporal coherence.

---

## How Priority Decay Works

### The Priority Formula

The Memory MCP uses a **type-dependent priority formula** that combines four factors:

```
Priority = (w_recency × Recency) + (w_importance × Importance)
         + (w_usage × Usage) + (w_emotion × Emotion)
```

Each component scores between 0.0 and 1.0, and the weights vary by memory type.

### Recency — The Exponential Decay Component

**Recency measures how "fresh" a memory is.** It uses exponential decay with a 30-day half-life, mimicking how human memory naturally fades over time.

**Formula:** `2^(-age_in_days / 30)`

**Half-life behavior:**

- **0 days old:** Recency = 1.0 (100% fresh)
- **30 days old:** Recency = 0.5 (50% fresh — half-life)
- **60 days old:** Recency = 0.25 (25% fresh)
- **90 days old:** Recency = 0.125 (12.5% fresh)
- **180 days old:** Recency ≈ 0.0156 (1.6% fresh)
- **365 days old:** Recency ≈ 0.0002 (< 0.1% fresh)

The recency score decays rapidly but never reaches zero, meaning very old memories can still be retrieved if they're important or heavily used.

### Other Components

**Importance** — How significant is this memory?

- High = 1.0
- Medium = 0.6
- Low = 0.3

**Usage** — How many times has this been accessed?

- 0 accesses: score = 0.0
- 10 accesses: score ≈ 0.52
- 50 accesses: score ≈ 0.85
- 100+ accesses: score = 1.0 (saturates)

**Emotion** — Emotional intensity (0.0–1.0 from metadata)

- Allows emotionally charged memories to resist decay slightly

### Type-Specific Weighting

Different memory types decay at different rates, reflecting human psychology where facts persist but experiences fade:

| Memory Type     | Recency | Importance | Usage | Emotion | Philosophy                    |
| --------------- | ------- | ---------- | ----- | ------- | ----------------------------- |
| **Episodic**    | 40%     | 20%        | 20%   | 20%     | Raw experiences fade fastest  |
| **Pattern**     | 25%     | 30%        | 30%   | 15%     | Learned patterns decay slower |
| **Semantic**    | 10%     | 50%        | 20%   | 20%     | Facts persist if important    |
| **Self/Belief** | 10%     | 40%        | 30%   | 20%     | Identity is importance-driven |

**Examples:**

- An episodic memory from 90 days ago (recency ≈ 0.125) would have very low priority
- A semantic memory from 90 days ago (recency weight is only 10%) remains accessible if marked high importance
- A belief marked `stability='canonical'` gets a floor of 0.4 priority, ensuring core identity never drops below that threshold

---

## Priority Decay Tables by Memory Type

The tables below show **priority snapshots** for memories ingested at different ages, assuming various importance levels and no usage/emotion boosts. Use these to understand how backdating affects your character's memory landscape.

### Episodic Memories (Experience Stories)

These decay fastest because raw experiences naturally fade over time. Use episodic type for events, conversations, and one-off activities.

**Formula:** `Priority = 0.4×recency + 0.2×importance + 0.2×usage + 0.2×emotion`

Assuming: `usage=0 accesses`, `emotion=0` (no emotional boost)

| Days Old | High Importance (1.0) | Medium (0.6) | Low (0.3) |
| -------- | --------------------- | ------------ | --------- |
| **0**    | 0.60                  | 0.52         | 0.46      |
| **7**    | 0.54                  | 0.46         | 0.40      |
| **30**   | 0.40                  | 0.32         | 0.26      |
| **60**   | 0.30                  | 0.22         | 0.16      |
| **90**   | 0.25                  | 0.17         | 0.11      |
| **180**  | 0.21                  | 0.13         | 0.07      |
| **365**  | 0.20                  | 0.12         | 0.06      |

**Interpretation:**

- A high-importance episode from 90 days ago (0.25) is still accessible but lower priority than recent episodes
- Low-importance episodes fade to near-zero within a year (0.06)
- High-importance episodes stabilize around 0.20 after a year due to the importance component

### Pattern Memories (Learned Behaviors)

Patterns decay slower than episodes—learned habits and recurring behaviors are more persistent. Use pattern type for routines, coping strategies, and discovered workflows.

**Formula:** `Priority = 0.25×recency + 0.3×importance + 0.3×usage + 0.15×emotion`

Assuming: `usage=0 accesses`, `emotion=0`

| Days Old | High Importance (1.0) | Medium (0.6) | Low (0.3) |
| -------- | --------------------- | ------------ | --------- |
| **0**    | 0.55                  | 0.43         | 0.34      |
| **7**    | 0.51                  | 0.39         | 0.30      |
| **30**   | 0.42                  | 0.30         | 0.21      |
| **60**   | 0.36                  | 0.24         | 0.15      |
| **90**   | 0.33                  | 0.21         | 0.12      |
| **180**  | 0.30                  | 0.18         | 0.09      |
| **365**  | 0.30                  | 0.18         | 0.09      |

**Interpretation:**

- Patterns from a year ago (0.30 high-importance) remain more accessible than episodic memories (0.20)
- Medium-importance patterns (0.21 at 90 days) stay retrievable longer than medium episodic (0.17)
- Pattern memories stabilize at their importance-weighted floor after ~6 months (recency contribution becomes negligible)
- Frequently accessed patterns (usage boost) can significantly exceed these baseline scores

### Semantic Memories (Facts and Knowledge)

Facts persist much longer than experiences. Use semantic type for factual knowledge, learned skills, and technical understanding.

**Formula:** `Priority = 0.1×recency + 0.5×importance + 0.2×usage + 0.2×emotion`

Assuming: `usage=0 accesses`, `emotion=0`

| Days Old | High Importance (1.0) | Medium (0.6) | Low (0.3) |
| -------- | --------------------- | ------------ | --------- |
| **0**    | 0.60                  | 0.40         | 0.25      |
| **7**    | 0.59                  | 0.39         | 0.24      |
| **30**   | 0.55                  | 0.35         | 0.20      |
| **60**   | 0.53                  | 0.33         | 0.17      |
| **90**   | 0.51                  | 0.31         | 0.16      |
| **180**  | 0.50                  | 0.30         | 0.15      |
| **365**  | 0.50                  | 0.30         | 0.15      |

**Interpretation:**

- High-importance semantic facts remain highly accessible indefinitely (0.50 floor, barely decays)
- Semantic memories decay much slower than episodic across all time horizons
- Medium-importance facts (0.31) at 90 days are significantly more available than medium episodic (0.17)
- After ~6 months, semantic memories stabilize at their importance-weighted floor (0.5×importance)

### Self & Belief Memories (Identity)

Core identity memories barely decay—who you are persists over time. Beliefs marked `stability='canonical'` never drop below 0.4 priority.

**Formula:** `Priority = 0.1×recency + 0.4×importance + 0.3×usage + 0.2×emotion`
**With canonical floor:** `Priority = max(calculated, 0.4)`

Assuming: `usage=0 accesses`, `emotion=0`

| Days Old | High Importance (1.0) | Medium (0.6) | Low (0.3) | Canonical Floor Applied   |
| -------- | --------------------- | ------------ | --------- | ------------------------- |
| **0**    | 0.50                  | 0.34         | 0.22      | High: 0.50, Med/Low: 0.40 |
| **7**    | 0.49                  | 0.33         | 0.21      | High: 0.49, Med/Low: 0.40 |
| **30**   | 0.45                  | 0.29         | 0.17      | High: 0.45, Med/Low: 0.40 |
| **60**   | 0.43                  | 0.27         | 0.14      | High: 0.43, Med/Low: 0.40 |
| **90**   | 0.41                  | 0.25         | 0.13      | High: 0.41, Med/Low: 0.40 |
| **180**  | 0.40                  | 0.24         | 0.12      | All: 0.40                 |
| **365**  | 0.40                  | 0.24         | 0.12      | All: 0.40                 |

**Interpretation:**

- Canonical beliefs (last column) are floored at 0.40 priority minimum
- High-importance canonical beliefs naturally stay above 0.40 for ~6 months, then touch the floor at 180+ days
- Medium and low-importance canonical beliefs hit the 0.40 floor immediately (their calculated priority is lower)
- Non-canonical low-importance beliefs decay to ~0.12 after a year
- Canonical stability is perfect for "core personality traits" that should never fade below retrievability threshold

---

## Practical Examples

### Example 1: YouTube Creator Archive (100+ Episodes)

**Scenario:** You're building a character who ran a YouTube channel from early 2024 through 2025. You have scripts, transcripts, and metadata for all 100 episodes. You want to ingest them with accurate timestamps to create a realistic memory profile of the character's learning and growth.

#### Step 1: Extract Metadata

```json
{
  "episode": 1,
  "title": "Productivity 101: Getting Started",
  "publish_date": "2024-03-15T10:00:00Z",
  "video_url": "https://youtube.com/watch?v=abc123",
  "transcript": "In this video, I'm going to...",
  "key_topics": ["productivity", "focus", "remote-work"]
}
```

#### Step 2: Structure Backdated Memories

The agent should ingest each episode as a **high-importance episodic memory** (representing a key production moment) plus **semantic memories** for key takeaways:

```json
{
  "input": "Remember all 100 episodes from my YouTube channel archive from 2024-2025",
  "files": ["archive/episodes.json"],
  "metadata": {
    "source": "youtube-archive",
    "memoryType": "episodic"
  }
}
```

The agent interprets the files and creates memories like:

```json
[
  {
    "text": "Produced episode 1: 'Productivity 101: Getting Started'. Discussed fundamental productivity techniques: time blocking, deep work, and distraction elimination. First episode launched channel on March 15, 2024.",
    "metadata": {
      "topic": "productivity",
      "importance": "high",
      "memoryType": "episodic",
      "source": "youtube-episode-1"
    },
    "timestamp": "2024-03-15T10:00:00Z"
  },
  {
    "text": "Key productivity technique: Deep work requires 90-minute uninterrupted blocks with full context loading. Used in multiple episodes.",
    "metadata": {
      "topic": "productivity",
      "importance": "high",
      "memoryType": "semantic",
      "source": "youtube-synthesis"
    },
    "timestamp": "2024-03-15T10:00:00Z" // Date of first episode where learned
  }
]
```

#### Step 3: Impact on Recall

After ingestion, when the character is asked "What have you learned about productivity?":

**Search finds:**

- Recent episodes (high recency): ~0.50–0.60 priority
- Episodes from 90 days ago: ~0.25 priority (episodic decay)
- Synthesized semantic knowledge: ~0.50–0.51 priority (facts barely decay)

**Recall synthesis:**
The character remembers the progression of their learning—early episodes from March have faded somewhat, recent episodes are vivid, but the core takeaways (semantic memories) remain accessible.

#### Step 4: Reinforcement via Usage

When the character recalls memories about productivity:

- `accessCount` increments
- Usage score grows (logarithmic saturation)
- Frequently retrieved memories stay above low-priority thresholds longer

---

### Example 2: Blog Migration (50+ Articles)

**Scenario:** Migrating a 3-year-old tech blog (2022–2025) into character memory. Articles span topics (Python, architecture, DevOps) and include publication dates in frontmatter.

#### Step 1: Extract Blog Metadata

Blog article frontmatter example:

```yaml
title: 'Designing Distributed Systems'
date: 2022-11-10
tags: [architecture, distributed-systems, python]
content: |
  When building distributed systems, you need to consider...
```

#### Step 2: Backdate by Article Publish Date

```json
{
  "input": "Migrate all articles from my tech blog archive",
  "files": ["blog-archive/posts/**/*.md"],
  "metadata": {
    "source": "tech-blog",
    "memoryType": "semantic"
  }
}
```

Agent creates semantic memories like:

```json
{
  "text": "Architectural insight: Consensus protocols (Raft, Paxos) are essential for distributed state management. Trade-offs: strong consistency vs. availability. Used Raft for internal systems with 99.99% uptime requirement.",
  "metadata": {
    "topic": "architecture",
    "importance": "high",
    "memoryType": "semantic",
    "tags": ["distributed-systems", "architecture"],
    "source": "blog-2022-11-10"
  },
  "timestamp": "2022-11-10T09:00:00Z" // Blog publish date
}
```

#### Step 3: Natural Decay Profile

**Priority timeline for high-importance semantic memory:**

- November 2022 (0 days): 0.60
- November 2024 (2 years ~730 days): 0.50 (stabilized at importance floor)
- November 2025 (3 years ~1095 days): 0.50 (remains stable)

Even after 3 years, high-importance semantic facts remain highly accessible (0.50 priority) due to the 50% importance weighting. Recent blog posts (from 2025) would only be slightly more prominent (0.55–0.60) due to recency, not dramatically higher.

#### Step 4: Cross-Reference with relationships

When creating new memories that build on old blog articles:

```json
{
  "text": "New insight from recent experience: My old 2022 consensus protocol understanding applies perfectly to this new database project.",
  "metadata": {
    "topic": "architecture",
    "importance": "high",
    "memoryType": "episodic"
  },
  "timestamp": "2025-11-18T10:00:00Z",
  "relationships": [
    {
      "targetId": "mem-raft-article-2022",
      "type": "derived_from"
    }
  ]
}
```

During recall with spreading activation, the old blog memory (at 0.50 priority for high-importance semantic) gets further boosted through the relationship edge and surfaces prominently in synthesis.

---

### Example 3: Project Timeline (Git History)

**Scenario:** Extracting a character's development journey from a GitHub repository. You want to create memories at key commits/milestones with historical accuracy.

#### Step 1: Extract Commit Timeline

```json
[
  {
    "commit": "abc123def456",
    "date": "2024-01-15T14:32:00Z",
    "message": "Initial project setup with TypeScript and ESLint",
    "author": "alice@example.com",
    "changes": 45,
    "tags": ["setup", "infrastructure"]
  },
  {
    "commit": "def456ghi789",
    "date": "2024-02-03T09:15:00Z",
    "message": "Add semantic search with pgvector",
    "author": "alice@example.com",
    "changes": 320,
    "tags": ["feature", "database"]
  },
  {
    "commit": "ghi789jkl012",
    "date": "2024-11-18T16:45:00Z",
    "message": "Implement spreading activation for recall",
    "author": "alice@example.com",
    "changes": 410,
    "tags": ["feature", "ai", "major"]
  }
]
```

#### Step 2: Create Milestone Memories

```json
{
  "input": "Remember the development milestones from my memory-mcp project on GitHub",
  "files": ["project-history.json"],
  "metadata": {
    "source": "github-history",
    "memoryType": "pattern" // Learned workflows over time
  }
}
```

Agent creates pattern memories:

```json
[
  {
    "text": "Project initialization: Set up TypeScript monorepo with ESLint, Prettier, and pre-commit hooks. Established testing framework and Docker setup.",
    "metadata": {
      "topic": "project-infrastructure",
      "importance": "high",
      "memoryType": "pattern",
      "source": "github-milestone"
    },
    "timestamp": "2024-01-15T14:32:00Z"
  },
  {
    "text": "Learned the importance of incremental feature rollout. Started with search (Feb 2024), then synthesis (Apr 2024), then relationships (Sep 2024), then spreading activation (Nov 2024). Each layer built on previous.",
    "metadata": {
      "topic": "project-methodology",
      "importance": "high",
      "memoryType": "pattern",
      "source": "github-synthesis"
    },
    "timestamp": "2024-01-15T14:32:00Z" // Earliest commit in timeline
  }
]
```

#### Step 3: Long-Tail Priority Preservation

**Pattern memory from January 2024 (~10 months / 300 days old):**

- Recency at 300 days: ≈ 0.00098 (negligible)
- Priority calculation: `0.25×recency(0.001) + 0.3×importance(1.0) + 0.3×usage(0) + 0.15×emotion(0) ≈ 0.30`
- Result: Still accessible for recall at the pattern's importance floor, represents foundational learning

**Major feature from November 2024 (recent, ~7 days old):**

- Recency at 7 days: ≈ 0.85
- Priority: `0.25×recency(0.85) + 0.3×importance(1.0) + 0.3×usage(0) + 0.15×emotion(0) ≈ 0.51`
- Result: Highly salient, fresh in memory

This creates a natural "learning curve" in recall where recent developments are more prominent but foundational work remains accessible.

---

## Workflows and Patterns

### Pattern 1: Bulk Ingestion with Consistent Timestamps

**Goal:** Ingest a large corpus of similar content (e.g., 100 blog posts) where you want to preserve the original creation dates.

**Workflow:**

1. **Extract metadata in batch** — Use a script to pull publish dates from file metadata, frontmatter, or database
2. **Structure as array** — Create JSON/CSV with `timestamp` fields per item
3. **Pass to agent** — Use `files` parameter with the metadata
4. **Agent handles extraction** — The LLM agent extracts timestamps and applies them consistently

**Example:**

```bash
# Extract publish dates from markdown files
find blog-archive -name "*.md" | while read file; do
  date=$(grep "^date:" "$file" | cut -d' ' -f2-)
  echo "{\"file\": \"$file\", \"timestamp\": \"$date\"}"
done > metadata.jsonl
```

Then pass `metadata.jsonl` to the agent's `files` parameter.

### Pattern 2: Gradual Ingestion with Refinement

**Goal:** Ingest old content incrementally while allowing the character to "consolidate" memories over time.

**Workflow:**

1. **Week 1:** Ingest 25 old blog articles (early 2022)
2. **Run `refine_memories`** → Consolidate related articles into pattern/belief memories
3. **Week 2:** Ingest next 25 articles (mid 2022)
4. **Run `refine_memories`** → Consolidate; form relationships to week 1 memories
5. **Continue:** Spread ingestion across weeks/months to simulate natural learning accumulation

**Benefit:** Memories form more natural relationship networks and the character "learns" rather than just being dump-loaded with facts.

### Pattern 3: Historical Depth with Varying Importance

**Goal:** Distinguish between foundational knowledge (high importance) and supporting details (medium/low importance) when backdating.

**Workflow:**

```json
{
  "text": "Foundational understanding: Distributed systems require consensus for state agreement",
  "metadata": {
    "importance": "high",
    "memoryType": "belief"
  },
  "timestamp": "2020-06-01T00:00:00Z" // Very old foundational belief
}
```

vs.

```json
{
  "text": "Specific implementation detail: PostgreSQL advisory locks can prevent race conditions in distributed tasks",
  "metadata": {
    "importance": "medium",
    "memoryType": "semantic"
  },
  "timestamp": "2022-11-15T10:00:00Z" // Older but less foundational
}
```

Result: Core identity/belief memories from years ago remain high priority; supporting details from 1–2 years ago have moderate priority.

### Pattern 4: Timestamped Relationships

**Goal:** Document how understanding evolved by linking memories with temporal context.

**Workflow:**

Create a "learning journey" relationship graph:

```json
{
  "memory_1": {
    "text": "First learned REST APIs in 2019",
    "timestamp": "2019-03-01T00:00:00Z",
    "id": "mem-rest-v1"
  },
  "memory_2": {
    "text": "Discovered GraphQL advantages over REST in 2021",
    "timestamp": "2021-06-15T00:00:00Z",
    "id": "mem-graphql-learn"
  },
  "memory_3": {
    "text": "Built production GraphQL service in 2023; REST vs GraphQL trade-offs clear now",
    "timestamp": "2023-09-10T00:00:00Z",
    "id": "mem-graphql-production",
    "relationships": [
      { "targetId": "mem-rest-v1", "type": "is_generalization_of" },
      { "targetId": "mem-graphql-learn", "type": "derived_from" }
    ]
  }
}
```

During recall, spreading activation traverses this timeline, allowing the character to narrate their learning journey naturally.

---

## Interactions with Other Features

### Spreading Activation with Backdated Memories

**How it works:**

The recall system uses **two-stage spreading activation** that weights memories by type and priority:

1. **Semantic search** finds candidate memories by embedding similarity
2. **Spreading activation** propagates along relationship edges, boosting identity-relevant memories

**Impact of backdating:**

```
Search for: "What have you learned about productivity?"

Stage 1 (Semantic):
  - Recent YouTube episode (recency ≈ 0.90): 0.50 priority
  - Old blog article (recency ≈ 0.20): 0.20 priority
  - Both score well semantically

Stage 2 (Spreading Activation):
  - Recent episode has relationships to 3 other memories
  - Old blog article has relationships to 8 other memories
  - Activation spreads via these edges

Result:
  - Old blog article (through relationships) activates 8 neighbors
  - Recent episode (through relationships) activates 3 neighbors
  - Even though old article has lower individual priority,
    its relationship network makes it surface in synthesis
```

**Best practice:** When backdating historical content, create explicit `relationships` that link old memories together. This ensures old material remains discoverable via spreading activation even as raw priority decays.

### Refinement with Backdated Memories

**How it works:**

The `refine_memories` tool consolidates, deduplicates, and reprioritizes memories. It respects timestamp integrity—it won't change a backdated timestamp.

**Operations affected:**

- **Consolidation** — Merges similar memories (e.g., multiple blog posts on the same topic) while preserving the earliest timestamp
- **Decay** — Recalculates priority using current date; old memories naturally re-prioritize downward
- **Cleanup** — Identifies low-priority candidates; old episodic memories become candidates faster than beliefs
- **Reflection** — Generates high-level summaries from clusters of related memories

**Example refinement with backdated content:**

```json
{
  "operation": "consolidation",
  "scope": {
    "query": "productivity techniques from my YouTube channel",
    "maxCandidates": 50
  },
  "dryRun": true
}
```

Refinement might propose:

```
Action 1: MERGE
  - Source: Episode 1 episodic memory (timestamp: 2024-03-15)
  - Source: Episode 2 episodic memory (timestamp: 2024-03-22)
  - Target: Create summary "Early productivity series established core framework"
  - New timestamp: 2024-03-15 (earliest)

Action 2: UPDATE
  - Memory: "Deep work 90-minute blocks" (episodic)
  - Current priority: 0.32 (90 days old)
  - Add relationships to 3 newer memories that reference this
  - Boost stability to 'stable' (from 'tentative')
```

**Key point:** Backdating + refinement creates a "lived history" where old episodic memories decay naturally, but important lessons (captured as semantic/pattern/belief memories) persist and become linked into ongoing understanding.

### Reconsolidation and Backdated Memories

**How it works:**

When memories are recalled (via `recall` tool), the system updates their access statistics. Over time, frequently recalled memories drift slightly—they can be reworded, reprioritized, or re-contextualized.

**Impact on backdated content:**

- **First recall:** Old backdated memory is retrieved with its original timestamp and priority
- **Repeated recalls:** Access count grows, usage score increases, priority potentially rises
- **Reconsolidation:** The memory might be subtly reworded or linked to new context, but **timestamp never changes**

**Example:**

```
Day 1 (Mar 15, 2024): Ingest episode 1 (timestamp: 2024-03-15, priority: 0.60)
Day 10 (Mar 25, 2024): Character recalls episode 1 (usage: 1, priority: 0.61)
Day 50 (May 04, 2024): Character recalls episode 1 again (usage: 2, priority: 0.62)
Day 300 (Jan 10, 2025): Character recalls episode 1 (usage: 5, priority: 0.52)
  - Recency has dropped to 0.12 (90 days old from Jan reference)
  - But usage boost keeps it above threshold
  - Timestamp remains 2024-03-15 (no change)

Result: Very old memory remains accessible due to frequent use, but decay is authentic
```

---

## Best Practices

### 1. Extract Dates from Source Metadata

**When possible, pull timestamps from the original source:**

- **Blog articles** — Use `published_date` or `date` from frontmatter
- **YouTube videos** — Use `publishedAt` from API or video metadata
- **Git commits** — Use commit `author_date` or `commit_date`
- **Email** — Use `Date` header from message
- **File system** — Use file modification time or creation time

**Why:** This ensures maximum temporal accuracy and avoids guessing.

**Example script (Bash):**

```bash
#!/bin/bash
# Extract dates from markdown files
for file in posts/*.md; do
  date=$(grep "^date:" "$file" | awk '{print $2}' | head -1)
  title=$(grep "^title:" "$file" | cut -d'"' -f2)
  echo "{\"file\": \"$file\", \"title\": \"$title\", \"timestamp\": \"${date}T00:00:00Z\"}"
done
```

### 2. Use Timestamp for When Content Was Created, Not When Ingested

**Correct:**

```json
{
  "text": "Historical event from blog archive",
  "timestamp": "2022-11-15T10:00:00Z" // When blog was published
}
```

**Incorrect:**

```json
{
  "text": "Historical event from blog archive",
  "timestamp": "2025-11-18T14:30:00Z" // Today's date (loses temporal context)
}
```

### 3. Match Memory Type to Content Age and Stability

**Guideline:**

| Content Age | Stable/Foundational | Exploratory/Recent | Recommended Type                |
| ----------- | ------------------- | ------------------ | ------------------------------- |
| 2+ years    | ✓                   | —                  | Belief/Semantic + maybe Pattern |
| 1–2 years   | ✓                   | ✓                  | Pattern or Semantic             |
| < 1 year    | —                   | ✓                  | Episodic or Pattern             |

**Reasoning:**

- Old foundational material should decay slowly (belief/semantic)
- Recent explorations should stay prominent (episodic)
- Patterns work well for multi-year learning trajectories

### 4. Create Relationships Between Related Backdated Memories

**When ingesting a large corpus, explicitly link related memories:**

```json
{
  "text": "Advanced productivity technique X",
  "metadata": { "importance": "high" },
  "timestamp": "2024-02-15T00:00:00Z",
  "relationships": [
    { "targetId": "mem-foundational-technique", "type": "derived_from" },
    { "targetId": "mem-related-case-study", "type": "example_of" }
  ]
}
```

**Why:** Spreading activation uses these edges; without them, old memories can become orphaned. Explicit relationships ensure old knowledge surfaces in recall through connections to newer contexts.

### 5. Plan Refinement Cycles After Bulk Backdating

**After ingesting large amounts of historical content, run refinement:**

```json
{
  "operation": "consolidation",
  "scope": {
    "query": "archived content from 2022-2023",
    "maxCandidates": 100
  },
  "dryRun": true // Review proposals first
}
```

**Goals:**

- Identify duplicates or near-duplicates
- Create high-level summaries
- Link episodic memories into patterns
- Establish foundation beliefs from key learnings

**Timing:** 1–2 weeks after large ingestion to allow relationship discovery.

### 6. Consider Emotional Context for Old Memories

**If certain old memories are emotionally charged, capture that:**

```json
{
  "text": "First major project failure in 2021",
  "metadata": {
    "emotion": { "intensity": 0.8 }, // High emotional charge
    "importance": "high",
    "memoryType": "episodic"
  },
  "timestamp": "2021-06-15T00:00:00Z"
}
```

**Effect:** Emotion component (20% for episodic) boosts priority even on old memories. High-emotion memories remain retrievable longer than neutral ones.

### 7. Document the Source of Backdated Memories

**Always tag the source:**

```json
{
  "metadata": {
    "source": "youtube-archive", // Clear origin
    "sourceVersion": "2024-11-18-export", // Date of export
    "importPath": "archive/episodes.json"
  }
}
```

**Why:** Makes it easy to re-import, update, or remove entire cohorts of historical memories if needed.

### 8. Test with a Sample Before Bulk Import

**When backdating large corpora:**

1. **Create a test index** — `create_index name="test_backdate"`
2. **Import 5–10 samples** — Verify timestamps, priority calculations, and recall behavior
3. **Run refinement** — Check consolidation proposals
4. **Inspect spreading activation** — Query `recall` and verify relationships are meaningful
5. **Then scale to full corpus** — Once confident, ingest everything

---

## Troubleshooting

### Memory Doesn't Appear in Recall Despite High Importance

**Problem:** Backdated memory is old (low recency) and not showing in recalls even though marked high importance.

**Solutions:**

1. Check if it's below the recall limit (default: 10 results)
2. Verify semantic search finds it (use `scan_memories` to debug)
3. Ensure it has relationships to current content (spreading activation)
4. For very important old memories, consider marking as `stability='canonical'` (belief type only)

### Timestamps Are Inconsistent Across Memories

**Problem:** Some memories have timestamps, some don't; or timestamps are in different formats.

**Solutions:**

1. Use `MetadataValidator` to standardize format (`YYYY-MM-DD` or ISO 8601)
2. Run `refine_memories` with cleanup operation to identify missing timestamps
3. When re-importing, ensure all records include timestamps

### Priority Drops Too Quickly (Episodic Memories)

**Problem:** Episodic memories become inaccessible after 60 days.

**Solutions:**

1. If memories are important, change type to `pattern` or `semantic` (slower decay)
2. Ensure they're used/accessed to boost usage score
3. Create relationships to pattern/belief memories that summarize their key points
4. Run refinement to generate summaries and promote to higher-level memory types

### Priority Stays Too High (Canonical Beliefs)

**Problem:** Canonical belief memories are flooring at 0.4 even when they should be lower.

**Solutions:**

1. Remove `stability='canonical'` if the memory is not core identity
2. Change memory type from `belief` to `semantic` (no canonical floor)
3. Use `refine_memories` to mark as `superseded` if outdated
4. Create an updated version and link with `contradicts` relationship

---

## Summary Table

| Concept                  | Field                      | Purpose                                   | Example                                           |
| ------------------------ | -------------------------- | ----------------------------------------- | ------------------------------------------------- |
| **Timestamp**            | `content.timestamp`        | Controls decay rate                       | `"2024-03-15T10:00:00Z"`                          |
| **Reference Date**       | `metadata.date`            | Semantic context                          | `"2024-03-15"` (YYYY-MM-DD)                       |
| **Recency Score**        | Calculated                 | Exponential decay, 30-day half-life       | 0 days: 1.0, 30 days: 0.5, 90 days: 0.125         |
| **Memory Type**          | `metadata.memoryType`      | Determines weight formula                 | episodic, pattern, semantic, belief, self         |
| **Episodic**             | Fast decay                 | Raw experiences                           | 0.60 priority → 0.32 in 90 days                   |
| **Pattern**              | Moderate decay             | Learned behaviors                         | 0.55 priority → 0.37 in 90 days                   |
| **Semantic**             | Slow decay                 | Facts and knowledge                       | 0.60 priority → 0.42 in 90 days                   |
| **Belief**               | Minimal decay              | Core identity                             | 0.50 priority → 0.40 in 90 days (canonical floor) |
| **Spreading Activation** | Relationships + type boost | Identity-biased recall                    | Old memories surface via edges to recent content  |
| **Refinement**           | Consolidation + decay      | Relationship formation & summary creation | Merge 10 episodes → 1 pattern memory              |

---

## Further Reading

- **[CHARACTER_MEMORY.md](CHARACTER_MEMORY.md)** — Design principles for character building
- **[SIMULATED_BRAIN.md](SIMULATED_BRAIN.md)** — Detailed explanation of decay, consolidation, and spreading activation
- **[prompts/memory-recall.txt](../prompts/memory-recall.txt)** — Recall synthesis prompt with two-stage activation
- **[src/memory/PriorityCalculator.ts](../src/memory/PriorityCalculator.ts)** — Source code for priority formulas
