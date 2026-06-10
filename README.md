# ScopeKit

**Scope your AI coding assistant to exactly the right part of your codebase — every time.**

When you ask an AI to fix something in one module, it loads the entire project. Token budgets bleed. Responses slow down. And with too much context, suggestions start stepping on code they shouldn't touch.

ScopeKit fixes this with an MCP server that gives the AI a focused brief — the right module plus its dependencies — before it edits a single file.

---

## How It Works

You maintain an `AGENTS/` directory in your project:

- **`INDEX.md`** — the master module registry: IDs, names, dependency graph, shared contracts
- **`MOD-XXX.md`** per module — a focused brief: owned files, architecture constraints, public API, gotchas

The MCP server exposes three tools. Before editing anything, Claude calls:

```
scopekit_get_context("MOD-003")
```

It gets back the auth module brief, every declared dependency brief, and the index. Nothing else. Then it edits only the files listed in that scope.

---

## Quickstart

### 1. Clone and build

```bash
git clone https://github.com/EagleMind/scopekit.git
cd scopekit/mcp-server && npm install && npm run build
```

### 2. Scaffold your project

**macOS / Linux:**
```bash
bash /path/to/scopekit/scripts/setup.sh "My Project"
```

**Windows (PowerShell):**
```powershell
& "C:\path\to\scopekit\scripts\setup.ps1" -ProjectName "My Project"
```

This creates `AGENTS/` with a blank `INDEX.md` and a quality checklist. No module files yet — those come in the next step.

### 3. Let the MCP server analyze your codebase

Once the MCP server is connected (step 5), tell Claude:

```
Run scopekit_scaffold to analyze this project and create the module files.
```

`scopekit_scaffold` walks the project tree and returns a structured breakdown. Claude uses that to propose module boundaries, then writes the `MOD-XXX.md` files and `AGENTS/INDEX.md` directly.

> **If your codebase isn't modular yet** — mixed concerns, no clear ownership, logic scattered across layers — the scaffold output will reflect that honestly. Claude will note the ambiguities and propose boundaries based on what the structure *should* be. Review those proposals carefully before accepting; a brief that misrepresents reality misleads the AI on every future edit.

### 4. Review the generated briefs

Open each `AGENTS/MOD-XXX.md` and verify:
- **Scope** lists the right files — nothing missing, nothing that belongs to another module
- **Critical Constraints** captures the things that silently break if ignored
- **Dependencies** are correct — no cycles, no missing links

Use `AGENTS/MODULE-CHECKLIST.md` as a guide.

### 5. Connect the MCP server

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": [
        "/absolute/path/to/scopekit/mcp-server/dist/index.js",
        "--root", "/absolute/path/to/your/project"
      ]
    }
  }
}
```

**Claude Code (CLI)** — add to `.claude/mcp_settings.json` in your project root:

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": ["/absolute/path/to/scopekit/mcp-server/dist/index.js"],
      "env": { "SCOPEKIT_ROOT": "/absolute/path/to/your/project" }
    }
  }
}
```

Restart your client after saving.

### 6. Add `CLAUDE.md` to your project

```bash
cp /path/to/scopekit/templates/CLAUDE.md.template /your/project/CLAUDE.md
```

This tells Claude to call the ScopeKit tools before touching any file. Without it, the tools exist but won't be used automatically.

### 7. Start scoped edits

```
MOD-002: add pagination to the user list endpoint
```

```
MOD-004: change the token expiry from 1h to 24h
```

Claude calls `scopekit_get_context`, reads the brief, edits only the files in scope.

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `scopekit_scaffold` | Analyze the project tree and generate module briefs + INDEX.md (run once at setup) |
| `scopekit_list_modules` | List all registered modules and their primary directories |
| `scopekit_get_context` | Load a module's brief + all transitive dependency briefs |
| `scopekit_resolve_module` | Find which module owns a given file path |

`scopekit_get_context` accepts a `module_id` (`"MOD-003"`) or a `file_path` (`"src/auth/login.ts"`). With a file path it resolves the owning module automatically.

---

## Dependency Resolution

When the AI calls `scopekit_get_context("MOD-003")`, given this graph:

```
MOD-007 (App Shell)
  ├── MOD-001 (DB Connection)
  │     └── MOD-004 (App Data Store)
  ├── MOD-002 (Annotations)
  │     └── MOD-001
  ├── MOD-003 (NLQ / AI)
  │     └── MOD-001
  └── MOD-005 (Backup)
        └── MOD-004
```

It receives:
- `MOD-003.md` — primary brief
- `MOD-001.md` — declared dependency
- `MOD-004.md` — transitive dependency of MOD-001
- `INDEX.md` — always included

Everything else stays out.

---

## What Goes in a Module Brief

The goal is not documentation. The goal is: *what does an AI need to know to work safely in this module without breaking things it can't see?*

**Include:**
- Exact file paths in scope
- Invariants and constraints that aren't obvious from reading the code
- What other modules call into this one (public API surface)
- Things that silently break if ignored

**Exclude:**
- Tutorials or explanations of how the code works
- Information that already lives in another module's brief
- Anything obvious from reading the source

A good brief is 100–300 lines. If it's longer than the files it describes, it's too detailed.

### Example

```markdown
---
id: MOD-001
name: API Layer
agent: 1
deps: []
---

## Scope

\`\`\`
src/services/api.ts         ← typed wrappers around every backend endpoint
src/services/auth.ts        ← login/logout/refresh token calls
src/utils/http.ts           ← base fetch wrapper (attaches tokens, handles 401)
src/types/api.ts            ← shared request/response interfaces
\`\`\`

## What This Module Does

All backend communication goes through this module. Typed async functions
wrap fetch calls, attach auth tokens, handle 401 auto-refresh, and normalize
error shapes before they reach the UI.

## Key Files

### `src/utils/http.ts`
- All API calls must go through `http.get/post/put/delete` — never call `fetch()` directly
- On a 401, calls `auth.refresh()` once and retries. If that also fails, dispatches `SESSION_EXPIRED`

### `src/types/api.ts`
- Every other module imports types from here — breaking changes here break every module

## Critical Constraints

- Tokens live in `httpOnly` cookies and the in-memory auth store — never `localStorage`
- All error paths must throw a typed `ApiError` — never swallow errors silently
```

---

## Module Templates

### React / Next.js

```
MOD-001: API Layer       → src/services/
MOD-002: State           → src/store/  or  src/context/
MOD-003: Pages / Routes  → src/pages/  or  src/app/
MOD-004: UI Components   → src/components/
MOD-005: Auth            → src/auth/
MOD-006: UI Primitives   → src/components/ui/
```

### Python (Django / FastAPI / Flask)

```
MOD-001: Data Models     → app/models/
MOD-002: API Routes      → app/routes/  or  app/views/
MOD-003: Business Logic  → app/services/
MOD-004: Auth            → app/auth/
MOD-005: Database Layer  → app/db/
```

### Rust / Go

```
MOD-001: Domain / Types  → src/domain/
MOD-002: Handlers        → src/handlers/
MOD-003: Service Layer   → src/services/
MOD-004: Storage / DB    → src/storage/
MOD-005: Middleware      → src/middleware/
```

### Monorepo

```
MOD-001: Package A       → packages/a/src/
MOD-002: Package B       → packages/b/src/
MOD-003: Shared Types    → packages/shared/
MOD-004: Build & Config  → build/  config/
MOD-005: E2E Tests       → e2e/
```

---

## Keeping Briefs Fresh

Briefs only work if they reflect reality.

- **File rename** — grep the old path in `AGENTS/` and update every reference
- **Module refactor** — update `MOD-XXX.md` as part of the same PR
- **Module split** — create the new `MOD-XXX.md`, update the dependency graph, update any briefs that referenced the old one
- **Code deletion** — if a deleted function was listed as a public API or constraint, remove the reference

A stale brief is worse than no brief — it confidently sends the AI in the wrong direction.

---

## File Structure

```
scopekit/
├── README.md
├── LICENSE
│
├── templates/
│   ├── INDEX.md.template          ← project registry template
│   ├── MODULE.md.template         ← per-module brief template
│   ├── CLAUDE.md.template         ← instructs Claude to use MCP tools
│   └── MODULE-CHECKLIST.md        ← quality checklist
│
├── scripts/
│   ├── setup.sh                   ← bootstrap script (macOS/Linux)
│   └── setup.ps1                  ← bootstrap script (Windows/PowerShell)
│
├── mcp-server/                    ← MCP server (TypeScript/Node.js)
│   ├── src/
│   │   ├── index.ts               ← server entry point, tool handlers
│   │   └── parser.ts              ← INDEX.md and MOD-XXX.md parsers
│   ├── package.json
│   └── tsconfig.json
│
└── examples/
    ├── react-spa/AGENTS/
    ├── python-api/AGENTS/
    └── tauri-app/AGENTS/
```

---

## FAQ

**Do I need this for a small project?**
No. Under ~5 files, just load everything. ScopeKit pays off at 7+ distinct modules, or when AI changes in one area keep accidentally touching another.

**How fine-grained should modules be?**
Aim for 5–10 per project. If a brief is getting long, the module probably wants to be split. If two modules are always loaded together, they might be one.

**Should I commit `AGENTS/` to version control?**
Yes. Treat it like an ADR directory — update it as the code evolves.

**What if two modules share a file?**
Note it in both briefs. Identify which module owns the file and what the other module's constraints are when touching it.

---

## Contributing

Pull requests welcome. Particularly interested in:
- `AGENTS/` examples for more project types (Rails, Laravel, Go, Svelte, etc.)
- Improvements to the templates based on real usage

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built while working on [IntelQuery](https://github.com/EagleMind/intelquery), a Tauri desktop app for database querying with AI.*
