import * as fs from 'fs';
import * as path from 'path';
import { ScopekitConfig, ModuleResolved } from './types.js';
import { walkFiles, matchGlob } from './fsutil.js';

export function agentsDir(root: string): string {
  return path.join(root, 'AGENTS');
}

export function configPath(root: string): string {
  return path.join(agentsDir(root), 'scopekit.json');
}

export function loadConfig(root: string): ScopekitConfig | null {
  const p = configPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ScopekitConfig;
  } catch {
    return null;
  }
}

export interface ProjectModel {
  config: ScopekitConfig;
  files: string[];
  modules: ModuleResolved[];
  /** First module to claim a file owns it. */
  fileToModule: Map<string, string>;
  /** Files claimed by more than one module. */
  overlaps: { file: string; modules: string[] }[];
}

export function buildModel(root: string, config: ScopekitConfig): ProjectModel {
  const files = walkFiles(root, config.ignore ?? []);

  const modules: ModuleResolved[] = config.modules.map(def => ({
    def,
    files: files.filter(f => def.globs.some(g => matchGlob(g, f))),
  }));

  const owners = new Map<string, string[]>();
  for (const m of modules) {
    for (const f of m.files) {
      const arr = owners.get(f) ?? [];
      arr.push(m.def.id);
      owners.set(f, arr);
    }
  }

  const fileToModule = new Map<string, string>();
  const overlaps: { file: string; modules: string[] }[] = [];
  for (const [f, ms] of owners) {
    fileToModule.set(f, ms[0]);
    if (ms.length > 1) overlaps.push({ file: f, modules: ms });
  }

  return { config, files, modules, fileToModule, overlaps };
}
