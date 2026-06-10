# Checklist — Writing a Good Module Context File

Use this before marking a context file as "done."

## Required Sections

- [ ] **Frontmatter**: `id`, `name`, `agent`, `deps` are filled in
- [ ] **Scope**: every file this module owns is listed with a brief annotation
- [ ] **Cross-cutting**: files in other modules that this one touches are listed
- [ ] **What It Does**: one paragraph — what problem does this module solve?
- [ ] **Key Files**: 2–4 files with real gotchas, invariants, and constraints
- [ ] **Public API**: shows exactly what other modules can call (type signatures or examples)
- [ ] **Critical Constraints**: the things that will silently break if ignored
- [ ] **Related Modules**: dependency links with a one-line reason

## Quality Checks

- [ ] Does the scope section list actual file paths (not directory blobs)?
- [ ] Are the constraints specific enough that a new developer wouldn't violate them?
- [ ] Does the "What It Does" section avoid explaining implementation and focus on purpose?
- [ ] Is there anything in this file that belongs in a different module's context instead?
- [ ] Would you hand this to a contractor who's never seen the codebase and trust they'd work safely?

## Avoid These Mistakes

- ❌ Listing every file in the project (only scope your module)
- ❌ Documenting HOW code works instead of WHAT to know before changing it
- ❌ Duplicating info that already lives in the other module's context
- ❌ Forgetting to update this file when you rename/move/delete files in scope
- ❌ Writing "this file handles X" — write "if you change X, also update Y because Z"

## Signs a Context File Is Too Thin

- You could write this from a README.md without reading the code
- There are no constraints or gotchas — every real module has at least one
- The API section has no types or examples

## Signs a Context File Is Too Fat

- It's longer than the source file it describes
- It explains every line of code
- It contains copy-pasted code blocks instead of links
