// Shared types for the ScopeKit core library.

export interface ModuleDef {
  id: string;
  name: string;
  /** Glob patterns defining which files this module owns. */
  globs: string[];
  /** Optional manual override of the import-derived dependency list. */
  deps?: string[];
}

export interface ScopekitConfig {
  project: string;
  modules: ModuleDef[];
  /** Files everyone should be aware of even if not editing them. */
  sharedContracts?: string[];
  /** Source roots used for alias resolution (e.g. "@/" → "src/"). Default ["src"]. */
  srcRoots?: string[];
  /** Extra directory names to ignore when walking the tree. */
  ignore?: string[];
}

export interface Anchor {
  /** Raw anchor token as written, e.g. "src/utils/http.ts::http". */
  raw: string;
  file: string;
  symbol?: string;
}

export interface Invariant {
  text: string;
  anchors: Anchor[];
}

export interface Brief {
  id: string;
  name: string;
  /** Public surface other modules rely on. Contributed to dependents. */
  contract: Invariant[];
  /** Caller-facing rules that silently break if ignored. Contributed to dependents. */
  invariants: Invariant[];
  /** Notes that only matter when editing this module itself. Never contributed. */
  internal: Invariant[];
  raw: string;
}

export interface ModuleResolved {
  def: ModuleDef;
  /** Project-relative file paths, expanded from globs against the real tree. */
  files: string[];
}
