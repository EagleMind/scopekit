import { ProjectModel } from './config.js';
import { matchGlob } from './fsutil.js';

/** Resolve a project-relative file path to its owning module id, or null. */
export function resolveModule(filePath: string, model: ProjectModel): string | null {
  const f = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  if (model.fileToModule.has(f)) return model.fileToModule.get(f)!;

  for (const [file, id] of model.fileToModule) {
    if (f.endsWith('/' + file) || file.endsWith('/' + f)) return id;
  }

  // Not-yet-created files: fall back to glob match so new files still resolve.
  for (const m of model.modules) {
    if (m.def.globs.some(g => matchGlob(g, f))) return m.def.id;
  }
  return null;
}
