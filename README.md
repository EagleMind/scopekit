# ScopeKit

**A plug-and-play system for scoping AI coding assistants to exactly the right part of your codebase.**

Every time you ask an AI assistant to fix something in one module, it loads the entire codebase. Your token budget bleeds. Responses take longer. And with so much noise, you sometimes get suggestions that step on other modules' toes.

ScopeKit solves this by giving each module its own context file, then spawning a focused agent that only loads what it actually needs.

---

## The Idea in One Sentence

> Instead of handing the AI a map of the whole city, give it a map of the one street it needs to fix.

---

## How It Works

You create an `AGENTS/` directory with:
- One `INDEX.md` — the master module registry
- One `MOD-XXX.md` per module — a focused context brief

When you want an edit, you tag it:

```
MOD-003: add rate limiting to the auth endpoint
```

Your AI assistant spawns with only:
1. `INDEX.md` — to understand the full module map
2. `MOD-003.md` — the primary briefing for the auth module
3. Context files of declared dependencies — read-only
4. Source files in MOD-003's scope

Everything else stays out.

---

## Quickstart

### 1. Clone ScopeKit (or copy the `templates/` and `scripts/` folders)

```bash
git clone https://github.com/EagleMind/scopekit.git
```

### 2. Run the setup script in your project root

**macOS / Linux:**
```bash
bash /path/to/scopekit/scripts/setup.sh "My Project" 6
```

**Windows (PowerShell):**
```powershell
& "C:\path\to\scopekit\scripts\setup.ps1" -ProjectName "My Project" -NumModules 6
```

This creates:
```
your-project/
└── AGENTS/
    ├── INDEX.md             ← fill this in first
    ├── MOD-001.md           ← one file per module
    ├── MOD-002.md
    ├── ...
    └── MODULE-CHECKLIST.md  ← quality checklist
```

### 3. Fill in `AGENTS/INDEX.md`

Replace the placeholder module names with your actual modules. Draw the dependency graph. List your shared contracts. Add your project-specific agent rules.

### 4. Fill in each `AGENTS/MOD-XXX.md`

Use `templates/MODULE.md.template` as a guide. The key sections:

- **Scope**: file paths this module owns
- **What It Does**: one paragraph
- **Key Files**: gotchas and constraints, not tutorials
- **Public API**: what other modules can call
- **Critical Constraints**: the things that silently break if ignored

Use `AGENTS/MODULE-CHECKLIST.md` to verify your work.

### 5. Trigger a scoped edit

```
MOD-002: add pagination to the user list endpoint
```

```
In MOD-004, change the token expiry from 1h to 24h
```

---

## File Structure

```
scopekit/
├── README.md
├── LICENSE                        ← MIT
│
├── templates/
│   ├── INDEX.md.template          ← project registry template
│   ├── MODULE.md.template         ← per-module context template
│   └── MODULE-CHECKLIST.md        ← quality checklist for context files
│
├── scripts/
│   ├── setup.sh                   ← bootstrap script (macOS/Linux)
│   └── setup.ps1                  ← bootstrap script (Windows/PowerShell)
│
└── examples/
    ├── react-spa/AGENTS/          ← React + Vite project example
    ├── python-api/AGENTS/         ← FastAPI / Flask project example
    └── tauri-app/AGENTS/          ← Tauri (Rust + React) project example
```

---

## What Goes in a Module Context File

The goal is not documentation. The goal is "what does an AI need to know to work safely in this module without touching things it shouldn't?"

**Include:**
- File paths in scope (precise, not a directory blob)
- The one or two things that will silently break if ignored
- What other modules call into this one (public API)
- Architecture gotchas that aren't obvious from the code

**Exclude:**
- Tutorials explaining how the code works
- Info that already lives in another module's context
- Things that are obvious from reading the source

A good context file is 100–300 lines. If it's longer than the files it describes, it's too detailed.

### Example: a real module context file

```markdown
---
id: MOD-001
name: DB Connection & Query Engine
agent: 1
deps: [MOD-004]
---

# MOD-001 — DB Connection & Query Engine

## Scope

\`\`\`
src-tauri/src/lib.rs        ← pool management, all Tauri commands
src/store/DbContext.tsx     ← React Context: connection state, schema
src/services/api.ts         ← typed Tauri IPC wrappers
\`\`\`

## What This Module Does

Manages the lifecycle of a live database connection: creates/destroys
connection pools (SQLite / PostgreSQL / MySQL), caches the full schema
on connect, executes queries, and exposes connection state via React Context.

## Key Files

### `lib.rs`
- `validate_table_name()` must be called before using table names in raw SQL — prevents injection
- All Tauri commands return `Result<T, String>` — never panic, always map errors to string
- New commands must be added to `invoke_handler![]` at the bottom of the file

### `DbContext.tsx`
- `markConnected(name, id, dbType)` — must pass all three args or downstream modules break
- `status.connectionId` is consumed by the Annotation module to scope its data

## Critical Constraints

- Any query logic change must handle all three arms of the `DatabasePool` enum
- Schema is cached — use `refresh_schema` if you need fresh data after a DDL change

## Related Modules

- **MOD-004**: owns connection metadata persistence
- **MOD-002**: reads `status.connectionId` to scope annotations
```

---

## Dependency Mapping

One of the most valuable parts of setup is drawing the dependency graph. It forces you to think about module boundaries you may not have articulated before.

```
MOD-007 (App Shell)
  ├── MOD-001 (DB Connection)
  │     └── MOD-004 (App Data Store)     ← foundational
  ├── MOD-002 (Annotations)
  │     └── MOD-001
  ├── MOD-003 (NLQ / AI)
  │     └── MOD-001
  └── MOD-005 (Backup)
        └── MOD-004
```

When an agent is spawned for MOD-003, it loads:
- `MOD-003.md` (primary)
- `MOD-001.md` (dependency)
- `MOD-004.md` (transitive dependency of MOD-001)
- `INDEX.md` (always)

Everything else stays out.

---

## Agent Rules

Your `INDEX.md` has a "Rules for Agents" section. Write rules that are specific to your project — the things your AI assistant keeps getting wrong. Some universal starting points:

```markdown
## Rules for Agents

1. Read only files in your scope unless a cross-module check is needed
2. For cross-module questions: read the other module's context first.
   Only read source if the context is insufficient
3. New shared types go in the shared contracts file, not inline
4. Use design tokens — no raw hex colors or magic numbers
5. Never store secrets in the application database — use OS keychain or env vars
```

Then add your own:

```markdown
6. All DB queries must use parameterized statements (never string interpolation)
7. New API endpoints require a corresponding entry in the OpenAPI spec
8. React components must be tested with React Testing Library, not Enzyme
```

---

## Adapting ScopeKit to Different Project Types

### React / Next.js

```
MOD-001: API Layer          → src/services/
MOD-002: State              → src/store/  or  src/context/
MOD-003: Pages / Routes     → src/pages/  or  src/app/
MOD-004: UI Components      → src/components/
MOD-005: Auth               → src/auth/
MOD-006: UI Primitives      → src/components/ui/
```

### Python (Django / FastAPI / Flask)

```
MOD-001: Data Models        → app/models/
MOD-002: API Routes         → app/routes/  or  app/views/
MOD-003: Business Logic     → app/services/
MOD-004: Auth               → app/auth/
MOD-005: Database Layer     → app/db/
```

### Rust / Go backend

```
MOD-001: Domain / Types     → src/domain/
MOD-002: Handlers           → src/handlers/
MOD-003: Service Layer      → src/services/
MOD-004: Storage / DB       → src/storage/
MOD-005: Auth / Middleware  → src/middleware/
```

### Monorepo (multiple packages)

```
MOD-001: Package A          → packages/a/src/
MOD-002: Package B          → packages/b/src/
MOD-003: Shared Types       → packages/shared/
MOD-004: Build & Config     → build/  config/
MOD-005: E2E Tests          → e2e/
```

---

## Keep Context Files Fresh

The system only works if the context files reflect reality. A few practices that help:

**When you rename a file**: grep for the old path in `AGENTS/` and update all references.

**When you refactor a module**: update its `MOD-XXX.md` as part of the PR.

**When you split a large module**: create a new `MOD-XXX.md`, update the dependency graph, update anything that referenced the old module.

**When you delete code**: if it was mentioned in a context file as a constraint or API, remove the reference.

A stale context file is worse than no context file — it confidently sends the agent in the wrong direction.

---

## FAQ

**Q: Do I need this for a small project?**
No. For under ~5 files, just load everything. ScopeKit pays off at 7+ distinct modules, or when you're regularly asking an AI assistant to make targeted changes in a large codebase.

**Q: Does this work with any AI assistant?**
Yes. The `AGENTS/` directory is just Markdown — any AI that can read files benefits from it. It works especially well with Claude (the `Agent` tool can be prompted to load only the scoped context) and with Cursor's context pinning feature.

**Q: How fine-grained should modules be?**
Aim for 5–10 modules per project. If a module's context file is getting long, it probably wants to be split. If two modules always need to be loaded together, they might be one module.

**Q: Should I commit `AGENTS/` to version control?**
Yes. It's documentation — it belongs in the repo. Treat it like you'd treat an ADR (Architecture Decision Record): update it as the code evolves.

**Q: What if two modules share a file?**
Use the "cross-cutting integration points" section in the module context to flag it. Note which module owns the file and what the other module's constraints are when touching it.

---

## Contributing

Pull requests welcome. Particularly interested in:
- Example `AGENTS/` directories for more project types (Rails, Laravel, Go, Svelte, etc.)
- Alternative setup scripts (Makefile, Node.js)
- Improvements to the templates based on real usage

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built while working on [IntelQuery](https://github.com/EagleMind/intelquery), a Tauri desktop app for database querying with AI. The pain of loading a 2,000-line codebase every time I needed to change one annotation export format inspired this system.*
