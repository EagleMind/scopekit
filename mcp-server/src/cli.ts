#!/usr/bin/env node
// ScopeKit CLI — `scopekit verify` (for CI) and `scopekit scaffold`.
import { findRoot, loadAll } from './core/load.js';
import { verify } from './core/verify.js';
import { scaffold } from './core/scaffold.js';

const [cmd, maybeRoot] = process.argv.slice(2);
const root = findRoot(maybeRoot);

if (cmd === 'verify') {
  const { model, graph } = loadAll(root);
  if (!model || !graph) {
    console.error(`No AGENTS/scopekit.json found at ${root}`);
    process.exit(2);
  }
  const findings = verify(root, model, graph);
  for (const f of findings) console.log(`[${f.level}] ${f.msg}`);
  const errors = findings.filter(f => f.level === 'error').length;
  const warns = findings.filter(f => f.level === 'warn').length;
  console.log(`\n${errors} error(s), ${warns} warning(s).`);
  process.exit(errors ? 1 : 0);
} else if (cmd === 'scaffold') {
  console.log(scaffold(root));
} else {
  console.log('Usage: scopekit <verify|scaffold> [root]');
  process.exit(2);
}
