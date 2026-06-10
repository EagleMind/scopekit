# Integrating ScopeKit into an Existing Project

This guide walks through wiring ScopeKit into a real codebase like IntelQuery.

---

## 1. Clone or Reference ScopeKit

Choose your integration style:

### Option A: Clone as a sibling (recommended for monorepos)

```bash
cd C:\Users\Hassen\Documents
git clone https://github.com/EagleMind/scopekit.git
```

Now you have:
```
Documents/
  ├── intelquery/           ← your project
  └── scopekit/             ← ScopeKit (shared)
```

### Option B: Copy into your project (for standalone projects)

```bash
cp -r /path/to/scopekit/mcp-server C:\Users\Hassen\Documents\intelquery\tools\scopekit-mcp
```

Then update paths in the config files below — they should point to `tools/scopekit-mcp/dist` instead of `../scopekit/mcp-server/dist`.

---

## 2. Build ScopeKit (One Time)

```bash
cd C:\Users\Hassen\Documents\scopekit\mcp-server
npm install
npm run build
```

This produces three executables in `dist/`:
- `mcp.js` — MCP server (context provider)
- `hook.js` — PreToolUse hook (enforcement)
- `cli.js` — `scopekit verify` (CI gate)

---

## 3. Set Up Your Project

Run the setup script in your project root:

```bash
bash C:\Users\Hassen\Documents\scopekit\scripts\setup.sh "IntelQuery"
```

This creates:
- `AGENTS/` directory
- `AGENTS/MODULE-CHECKLIST.md` (quality checklist)
- `CLAUDE.md` (tells Claude to load context before editing)

---

## 4. Wire the MCP Server

### For Claude Code (CLI)

Create `.claude/mcp_settings.json` in your project root:

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": ["C:\\Users\\Hassen\\Documents\\scopekit\\mcp-server\\dist\\mcp.js"],
      "env": { "SCOPEKIT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

The `${workspaceFolder}` variable expands to your project root, and the server walks up to find `AGENTS/scopekit.json`.

### For Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": [
        "C:\\Users\\Hassen\\Documents\\scopekit\\mcp-server\\dist\\mcp.js",
        "--root",
        "C:\\Users\\Hassen\\Documents\\intelquery"
      ]
    }
  }
}
```

Then restart Claude Desktop. You should see a "scopekit" server listed in the Tools section.

---

## 5. Wire the Enforcement Hook

Only Claude Code supports PreToolUse hooks (not Claude Desktop yet).

Update `.claude/mcp_settings.json` to add the hook configuration:

```json
{
  "mcpServers": {
    "scopekit": {
      "command": "node",
      "args": ["C:\\Users\\Hassen\\Documents\\scopekit\\mcp-server\\dist\\mcp.js"],
      "env": { "SCOPEKIT_ROOT": "${workspaceFolder}" }
    }
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\Users\\Hassen\\Documents\\scopekit\\mcp-server\\dist\\hook.js"
          }
        ]
      }
    ]
  }
}
```

The hook will:
1. Intercept edits to any file
2. Resolve the file to its module (if one is registered)
3. Track session state in `%TMP%\scopekit\<hash>\<session_id>.json`
4. On first edit to a module: deny the edit and inject the brief
5. On retry: allow silently (and on subsequent edits to the same module)

---

## 6. Generate Your Module Structure

Open Claude Code in your IntelQuery directory:

```bash
cd C:\Users\Hassen\Documents\intelquery
code .
```

Tell Claude:

```
Run scopekit_scaffold to analyze this project and propose module boundaries.
```

Claude will:
1. Walk your codebase (respecting `.gitignore` and ignoring `node_modules`, `.git`, etc.)
2. Map directory structure
3. Parse imports to find real coupling between directories
4. Return a structured analysis with the real import edges

Review the output. It shows:
- **Source groups** (candidate modules based on directory structure)
- **Import edges** (actual dependencies — who imports from whom)

Claude uses this to propose `AGENTS/scopekit.json` and the `MOD-XXX.md` briefs.

---

## 7. Review and Accept the Generated Structure

Claude will offer to write:
- `AGENTS/scopekit.json` — module config with globs
- `AGENTS/MOD-001.md`, `MOD-002.md`, etc. — one brief per module

**Before accepting**, read through the scaffold output:
- Do the proposed modules make sense given the import edges?
- Are high-coupling groups merged? (e.g., if `src/store` and `src/context` import each other heavily, they're probably one module)
- Are unrelated directories in the same group? (if so, propose a split)

**Once you approve**, Claude writes the files. The globs are derived from your directory structure, and dependencies are parsed from imports (not hand-drawn).

---

## 8. Verify the Briefs

Run the verifier:

```bash
node C:\Users\Hassen\Documents\scopekit\mcp-server\dist\cli.js verify
```

Output should be clean:

```
0 error(s), 0 warning(s).
```

If there are errors:
- **Dead globs** — a glob matches no files. Adjust the glob in `scopekit.json`.
- **Stale anchors** — an `@anchor` points at a file/symbol that no longer exists. Update the brief or the code.

---

## 9. Add to Git (Optional but Recommended)

```bash
git add AGENTS/ CLAUDE.md
git commit -m "Add ScopeKit module scoping structure"
```

The briefs are documentation and belong in version control. Update them as the code evolves.

---

## 10. Wire into CI (Optional but Recommended)

Add a GitHub Actions workflow (or equivalent for your CI):

```yaml
# .github/workflows/scopekit-verify.yml
name: ScopeKit Verify

on: [pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
      - run: |
          npm install --prefix scopekit/mcp-server
          npm run build --prefix scopekit/mcp-server
          node scopekit/mcp-server/dist/cli.js verify
```

This ensures every PR's changes pass the staleness check: anchors still point to real symbols, globs still match files, etc.

---

## Now You're Ready

### For Any Scoped Edit

```
MOD-003: fix the token caching bug
```

Flow:
1. Hook intercepts your edit to a file in MOD-003
2. **First touch**: hook denies the edit, injects MOD-003's brief
3. Claude reads: *"You own these files. Respect these invariants. MOD-001 contract is X; MOD-002 contract is Y."*
4. Claude re-issues the edit → hook allows it
5. Claude proceeds, scoped and informed
6. Subsequent edits to MOD-003 pass silently (brief is loaded for the session)

### Per-Session State

The hook tracks what's been loaded per session (stored in `%TMP%`):
- First edit to MOD-003 this session → deny + inject
- Second edit to MOD-003 this session → silent allow
- First edit to MOD-001 this session → deny + inject (different module)

Restarting Claude Code clears the session state, so on the next start you're fresh.

---

## Example: IntelQuery Structure

If IntelQuery has this shape:

```
src-tauri/src/
  lib.rs              ← Tauri commands, FFI
  
src/
  store/
    DbContext.tsx     ← Connection state
    useQuery.ts       ← Query hook
  services/
    api.ts            ← Tauri IPC wrappers
  components/
    QueryEditor.tsx
    ResultTable.tsx
  types/
    database.ts
```

ScopeKit might generate:

```json
{
  "project": "IntelQuery",
  "srcRoots": ["src", "src-tauri/src"],
  "modules": [
    { "id": "MOD-001", "name": "DB Connection", "globs": ["src/store/**", "src-tauri/src/lib.rs"] },
    { "id": "MOD-002", "name": "API Layer", "globs": ["src/services/**"] },
    { "id": "MOD-003", "name": "UI Components", "globs": ["src/components/**"] }
  ],
  "sharedContracts": ["src/types/database.ts"]
}
```

And three briefs explaining:
- MOD-001: manages connection lifecycle, exposes `DbContext`
- MOD-002: wraps Tauri IPC calls
- MOD-003: consumes the store and services

---

## Troubleshooting

### Hook not firing

Make sure `.claude/mcp_settings.json` is valid JSON and the `hooks` section is present. Claude Code reads this on startup; if it's malformed, settings won't load.

### "No module found for X"

The file is outside any module's globs. Either:
1. The file is out of scope and shouldn't be edited by AI (leave it alone)
2. Adjust the glob in `scopekit.json` to include it
3. Add the file path manually to a module's glob list

### Verify fails with stale anchors

A brief claims `@anchor src/utils/http.ts::validateToken`, but the function was renamed to `validate`. Update the brief and re-run verify.

### MCP tools not showing up

For Claude Code: restart the editor after editing `.claude/settings.json`.
For Claude Desktop: restart the app after editing `claude_desktop_config.json`.

---

## Next Steps

1. **Generate the briefs** (run `scopekit_scaffold` via Claude)
2. **Verify** (`scopekit verify`)
3. **Use them**: tag a task with `MOD-XXX:` and Claude will load the context
4. **Keep them fresh**: update briefs when the code changes, verify in CI

That's it. You've integrated ScopeKit.
