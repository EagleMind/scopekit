import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, buildModel, ProjectModel } from './config.js';
import { buildDepGraph, DepGraph } from './imports.js';

/** Walk up from `start` looking for an AGENTS/ directory; fall back to the start dir. */
export function findRoot(start?: string): string {
  const begin = path.resolve(start || process.env.SCOPEKIT_ROOT || process.cwd());
  let dir = begin;
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, 'AGENTS', 'scopekit.json')) ||
      fs.existsSync(path.join(dir, 'AGENTS', 'INDEX.md'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return begin;
}

export interface Loaded {
  root: string;
  model: ProjectModel | null;
  graph: DepGraph | null;
}

export function loadAll(root: string): Loaded {
  const config = loadConfig(root);
  if (!config) return { root, model: null, graph: null };
  const model = buildModel(root, config);
  const graph = buildDepGraph(root, model);
  return { root, model, graph };
}
