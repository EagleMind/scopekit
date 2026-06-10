#!/usr/bin/env node
// ScopeKit PreToolUse hook — the ENFORCEMENT layer.
// On the first edit to a file in a module this session, it denies the edit once and
// injects that module's scoped context as the denial reason. The retry is allowed.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { findRoot, loadAll } from './core/load.js';
import { resolveModule } from './core/resolve.js';
import { buildContext } from './core/context.js';

function allow(): never {
  process.exit(0);
}

function deny(reason: string): never {
  const payload = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
  // Synchronous write guarantees the bytes flush before exit — an async
  // process.stdout.write() can be truncated by process.exit().
  fs.writeSync(1, payload);
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise(res => {
    let d = '';
    process.stdin.on('data', c => (d += c));
    process.stdin.on('end', () => res(d));
    setTimeout(() => res(d), 2000); // never hang
  });
}

function stateFile(root: string, sessionId: string): string {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), 'scopekit', key);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId || 'nosession'}.json`);
}

function loadState(p: string): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(p, 'utf8')).loaded as string[]);
  } catch {
    return new Set();
  }
}

function saveState(p: string, s: Set<string>): void {
  try {
    fs.writeFileSync(p, JSON.stringify({ loaded: [...s] }));
  } catch { /* best effort */ }
}

(async () => {
  let input: any = {};
  try {
    input = JSON.parse(await readStdin());
  } catch {
    allow();
  }

  const toolInput = input.tool_input ?? {};
  const filePath: string | undefined = toolInput.file_path ?? toolInput.path;
  if (!filePath) allow();

  const cwd: string = input.cwd || process.cwd();
  const root = findRoot(cwd);
  const { model, graph } = loadAll(root);
  if (!model || !graph) allow(); // ScopeKit not configured here — stay out of the way.

  const relPath = path.relative(root, path.resolve(cwd, filePath!)).split(path.sep).join('/');
  const moduleId = resolveModule(relPath, model!);
  if (!moduleId) allow(); // file not owned by any module — free to edit.

  const sp = stateFile(root, input.session_id);
  const loaded = loadState(sp);
  if (loaded.has(moduleId!)) allow(); // already briefed for this module this session.

  // First touch: inject the brief and block this one edit.
  const ctx = buildContext(root, model!, graph!, moduleId!);
  loaded.add(moduleId!);
  saveState(sp, loaded);

  deny(
    `ScopeKit: you are editing a file owned by ${moduleId}. Load its scoped context first.\n\n` +
    ctx +
    `\n\n---\nThis context for ${moduleId} is now loaded for the rest of this session. ` +
    `Re-issue your edit to proceed — you will not be interrupted again for ${moduleId}. ` +
    `Edit only the files listed under ${moduleId}'s scope above.`
  );
})();
