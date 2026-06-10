# ScopeKit

**Scope your AI coding assistant to exactly the right part of your codebase — and enforce it.**

When you ask an AI to fix something in one module, it loads the entire project. Token budgets bleed, responses slow down, and changes in one area start stepping on code they shouldn't touch.

ScopeKit gives each module a tight, anchored brief, derives ownership and dependencies from your real import graph, and uses a PreToolUse hook to make the AI load the right context *before* it edits anything.

---

## Architecture

ScopeKit is three pieces sharing one core:

| Piece | Role | Mechanism |
|-------|------|-----------|
| **MCP server** | Provider | Exposes tools the AI calls to load scoped context. Portable across MCP clients. |
| **PreToolUse hook** | Enforcement | Blocks the first edit to a module until its context is loaded, then injects it. The thing that makes "should" into "must". |
| **CLI (`scopekit verify`)** | Freshness | Checks every brief against the live code in CI. Stale briefs fail the build. |

What you author is deliberately small. Everything derivable from code is derived:

- **File ownership** comes from globs in `AGENTS/scopekit.json` — not hand-listed.
- **Dependencies** come from your actual `import`/`require`/`use` statements — not a hand-drawn graph.
- **Judgment** — the invariants that silently break if ignored — is the only prose you write, and every claim is anchored to a real symbol so it can be verified.

---

## How a scoped edit works

1. You (or the AI) start editing `src/auth/login.ts`.
2. The hook resolves the path → `MOD-004`, sees you haven't loaded it this session, **blocks the edit once**, and injects MOD-004's brief: its files, its contract, its invariants, plus the *contract surface* of every module it depends on.
3. You re-issue the edit. It proceeds. You won't be interrupted again for MOD-004 this session.

A dependency contributes only its **Contract** and **Invariants** — never its internal notes. You get the boundary you need to respect, not the noise you don't.

---

## Why this is efficient

**Traditional approach:** Load the entire codebase (or "the relevant part" you guess at), hope the AI respects it, watch it waste tokens on things it shouldn't touch.

**ScopeKit approach:** Load only what's needed, enforce the boundary structurally, keep briefs honest.

### Token savings

Measured by running `npm run bench` against projects of increasing size. Each row is the context injected before editing a single module.

| Strategy | 6 files / ~40 LOC | 6 files / ~164 LOC | 25 files / ~1,870 LOC | 25 files / ~4,680 LOC |
| :--- | :--- | :--- | :--- | :--- |
| Full codebase dump | 374 tok | 1,795 tok | 18,199 tok | 43,044 tok |
| Module files only | 32 tok (−91%) | 457 tok (−75%) | 2,978 tok (−84%) | 6,597 tok (−85%) |
| Module + dep source files | 343 tok (−8%) | 1,219 tok (−32%) | 10,183 tok (−44%) | 23,690 tok (−45%) |
| **ScopeKit** (this tool) | **335 tok** (1.1×) | **433 tok** (**4.1×**) | **1,183 tok** (**15.4×**) | **1,183 tok** (**36.4×**) |

> Token estimates: cl100k\_base ≈ 3.5 chars / token (standard for TypeScript/Python code).  
> ScopeKit context = module map + brief (Contract / Invariants / Internal) + transitive dep contracts.  
> The AI still reads target module files directly; ScopeKit *replaces* reading dep source with structured contracts.

The critical property: **ScopeKit's context stays flat** — 1,183 tokens whether the codebase has 1,870 or 4,680 LOC. Every other strategy scales with codebase size. The gap keeps growing.

"Module files only" looks cheaper at first glance, but it omits dependency contracts entirely — the AI doesn't know what it must not break. ScopeKit delivers *fewer tokens than reading just the target module* while also including the complete contract surface of every dependency.

**Session savings:** The hook tracks what's loaded per-session, so you're not re-injecting a module's context on every edit — just once on the first touch per session.

### Correctness

Traditional: "Read this graph of dependencies" (hand-drawn, drifts). AI reads it, still not sure if it's right, sometimes ignores it entirely.

ScopeKit:
- **Deps derived from imports** — no drift, always reflects reality.
- **Contract-only dep slices** — you get exactly the boundary, not the noise.
- **Anchored claims** — every invariant says `@anchor src/utils/http.ts::http`. `verify` fails CI if that symbol disappears. Briefs can't quietly rot.
- **Enforcement hook** — the first edit to a module *requires* loading its context. Not a suggestion; you won't edit until you've read the brief.

### Why the hook matters

Without it, the MCP tools are optional. The AI can ignore them, just like it can ignore a `CLAUDE.md` file. A well-intentioned-but-optional system fails in practice.

The hook makes it structural: you try to edit → hook blocks once → brief is injected as the denial reason → you read it → you retry → you're locked in for the session. The AI doesn't choose to load context; it's required to.

---

## Quickstart

### 1. Clone and build

```bash
git clone https://github.com/EagleMind/scopekit.git
cd scopekit/mcp-server && npm install && npm run build
```

This produces three executables in `dist/`: `mcp.js` (server), `hook.js` (enforcement), `cli.js` (verify).

### 2. Scaffold your project

```bash
bash /path/to/scopekit/scripts/setup.sh "My Project"      # macOS / Linux
```
```powershell
& "C:\path\to\scopekit\scripts\setup.ps1" -ProjectName "My Project"   # Windows
```

Creates `AGENTS/` and drops a `CLAUDE.md` in your project root. No module count to guess — that comes next.

### 3. Connect the server and the hook

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": ["/abs/path/to/scopekit/mcp-server/dist/mcp.js", "--root", "/abs/path/to/your/project"]
    }
  }
}
```

**Claude Code** — `.claude/settings.json` in your project. This registers *both* the MCP server and the enforcement hook:

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": ["/abs/path/to/scopekit/mcp-server/dist/mcp.js"],
      "env": { "SCOPEKIT_ROOT": "${workspaceFolder}" }
    }
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node /abs/path/to/scopekit/mcp-server/dist/hook.js" }
        ]
      }
    ]
  }
}
```

The hook reads the edit's `cwd` and walks up to find `AGENTS/scopekit.json`, so it stays out of the way in projects that don't use ScopeKit.

### 4. Generate the module structure

Tell Claude:

```
Run scopekit_scaffold, then create scopekit.json and the briefs.
```

`scopekit_scaffold` walks the tree and reports the **real import edges between directories** — actual coupling, not directory-name guesswork. Claude uses that to write `AGENTS/scopekit.json` (modules + globs) and one `AGENTS/MOD-XXX.md` brief per module.

> **If your codebase isn't modular yet** — mixed concerns, no clear ownership — the scaffold output reflects that honestly, and Claude will propose boundaries based on what the structure *should* be. Review before accepting; a brief that misrepresents reality misleads every future edit.

### 5. Verify

```bash
cd your-project && node /path/to/scopekit/mcp-server/dist/cli.js verify
```

Every glob must match files; every `@anchor` must point at a symbol that still exists. Wire this into CI so briefs can't rot silently.

---

## Authoring a brief

`AGENTS/scopekit.json` defines structure:

```json
{
  "project": "My App",
  "srcRoots": ["src"],
  "modules": [
    { "id": "MOD-001", "name": "API Layer", "globs": ["src/services/**", "src/utils/http.ts", "src/types/**"] },
    { "id": "MOD-002", "name": "Store",     "globs": ["src/store/**"] }
  ],
  "sharedContracts": ["src/types/api.ts"]
}
```

Each `AGENTS/MOD-XXX.md` holds judgment only — three sections, every claim anchored:

```markdown
---
id: MOD-001
name: API Layer
---

## Contract
- `http.get/post` is the only sanctioned way to reach the backend. @anchor src/utils/http.ts::http
- `ApiError` is the shape every failed call carries. @anchor src/types/api.ts::ApiError

## Invariants
- Never call `fetch()` directly — always go through `http`. @anchor src/utils/http.ts
- Shared types ripple to every module; coordinate before changing them. @anchor src/types/api.ts

## Internal
- `http` must stay free of business logic. @anchor src/utils/http.ts
```

- **Contract** — public surface dependents rely on. Contributed to dependents.
- **Invariants** — caller-facing rules that break things if ignored. Contributed to dependents.
- **Internal** — only matters when editing *this* module. Never contributed.

Don't list files (globs derive them). Don't explain how the code works (the reader can read it). `@anchor path` or `@anchor path::symbol` — `scopekit verify` fails when an anchor goes stale. That's the freshness guarantee.

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `scopekit_scaffold` | Analyze the import graph and propose modules (first-time setup) |
| `scopekit_get_context` | Load a module's scope + contracts of its dependencies (`module_id` or `file_path`) |
| `scopekit_resolve_module` | Find which module owns a file |
| `scopekit_list_modules` | Browse the registry |
| `scopekit_verify` | Check briefs against the live code |

---

## File Structure

```
scopekit/
├── README.md
├── LICENSE
│
├── templates/
│   ├── scopekit.json.template     ← module config skeleton
│   ├── MODULE.md.template         ← brief format (Contract / Invariants / Internal)
│   ├── CLAUDE.md.template         ← tells Claude to load context before editing
│   └── MODULE-CHECKLIST.md        ← quality checklist
│
├── scripts/
│   ├── setup.sh / setup.ps1       ← bootstrap AGENTS/ + CLAUDE.md
│
├── mcp-server/
│   ├── src/
│   │   ├── core/                  ← shared library (config, imports, briefs, verify, context)
│   │   ├── mcp.ts                 ← MCP server (provider)
│   │   ├── hook.ts                ← PreToolUse hook (enforcement)
│   │   └── cli.ts                 ← scopekit verify / scaffold
│   └── fixture/                   ← tiny worked example (also the test target)
│
└── examples/
    └── react-spa/AGENTS/          ← reference brief set
```

---

## FAQ

**Does the hook get in my way?**
Once per module per session, on the first edit — it injects the brief and you retry. Files in no module pass through untouched, and projects without `AGENTS/scopekit.json` are ignored entirely.

**What if my client doesn't support hooks?**
You lose enforcement but keep the provider: the MCP tools and `CLAUDE.md` still steer the AI to load context. Enforcement is hook-only and honest about that.

**Do I maintain the dependency graph?**
No. It's derived from imports. You can override a module's deps in `scopekit.json` if you have runtime-only coupling, and `verify` will flag declared-vs-real drift.

**How do briefs stay accurate?**
Anchors. Every claim references a file or symbol; `scopekit verify` fails CI when one disappears. A brief can't quietly drift from the code without breaking the build.

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built while working on [IntelQuery](https://github.com/EagleMind/intelquery), a Tauri desktop app for database querying with AI.*
