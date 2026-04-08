# Test Builder Migration Design

Migrate all 47 Positron test files to use `createTestContainer()` from `positronTestContainer.ts`, eliminating manual setup patterns and establishing the builder as the single way to write Positron tests.

## Motivation

1. **Command consistency** -- The `/unit-tests-author` command currently needs two code paths: "use the builder" for new files and "match existing patterns" for extending files. After migration, it can say "always use the builder" with no caveats.
2. **Reduced boilerplate** -- Human devs see one pattern instead of three. New contributors don't need to understand `ensureNoDisposablesAreLeakedInTestSuite()`, `createRuntimeServices()`, and `positronWorkbenchInstantiationService()` as separate concepts.

## Scope

47 Positron-owned test files in `src/vs/workbench/`. Upstream VS Code test files are not touched.

### File categories

| Category | Files | Tests | Migration effort |
|----------|-------|-------|-----------------|
| Disposables only | 36 | ~300 | Trivial -- 2-line change per file |
| `createRuntimeServices` | 4 | ~65 | Medium -- swap to `.withRuntimeServices()` |
| `positronWorkbenchInstantiationService` | 7 | ~64 | Medium -- swap to `.withWorkbenchServices()` or `.withNotebookServices(doc)` |

## Builder change: parameterized `.withNotebookServices()`

Extend `.withNotebookServices()` to accept an optional `NotebookTextModel` parameter. When provided, stubs `INotebookService` to return that document.

```typescript
// Current (no change):
.withNotebookServices()

// New (optional param):
.withNotebookServices(testNotebookDocument)
```

This replaces ~15 lines of manual stub setup in each of the 3 `runtimeNotebookKernel` test files.

The remaining 4 `positronWorkbenchInstantiationService` files use `.withWorkbenchServices()` + `.stub()` for their file-specific needs.

## Migration patterns

### Disposables-only files (36 files)

```typescript
// Before:
const disposables = ensureNoDisposablesAreLeakedInTestSuite();

// After (destructured so rest of file is unchanged):
const { disposables } = createTestContainer().build();
```

Only the import and declaration line change. The `disposables` variable keeps the same name and type.

### createRuntimeServices files (4 files)

```typescript
// Before:
const disposables = ensureNoDisposablesAreLeakedInTestSuite();
let instantiationService: TestInstantiationService;
setup(() => {
    instantiationService = disposables.add(new TestInstantiationService());
    createRuntimeServices(instantiationService, disposables);
});

// After:
const ctx = createTestContainer().withRuntimeServices().build();
```

Services accessed via `ctx.get(IService)`. Disposables via `ctx.disposables`. Instantiation service via `ctx.instantiationService`.

For `runtimeSession.test.ts` (55 tests, 10+ helpers): all helpers updated to reference `ctx.instantiationService` and `ctx.disposables`. The `setup()` block retains file-specific work that depends on per-test state: config overrides (`configService.setUserConfiguration`), workspace trust (`workspaceTrustManagementService.setWorkspaceTrust`), runtime metadata creation (`createTestLanguageRuntimeMetadata`), and session disposal cleanup.

### positronWorkbenchInstantiationService files (7 files)

3 notebook kernel files:
```typescript
// Before:
instantiationService = positronWorkbenchInstantiationService(disposables);
instantiationService.stub(INotebookService, testNotebookService);
// ...more notebook stubs

// After:
const ctx = createTestContainer()
    .withNotebookServices(testNotebookDocument)
    .build();
```

4 remaining files use `.withWorkbenchServices()` + `.stub()`.

## Execution order

1. Update `positronTestContainer.ts` -- add optional `NotebookTextModel` param to `.withNotebookServices()`
2. Migrate 36 disposables-only files, run tests
3. Migrate 4 `createRuntimeServices` files, run tests
4. Migrate 7 `positronWorkbenchInstantiationService` files, run tests
5. Update `/unit-tests-author` command -- remove "match existing patterns" escape hatch
6. Update `.claude/rules/core-tests.md` and `CLAUDE.md` -- remove references to manual setup as primary pattern

## What does NOT change

- Upstream VS Code test files
- Test behavior -- every test produces identical results before and after
- The builder's existing API (only adds an optional param to one method)
- The builder's internal setup hook ordering

## Risks and mitigations

- **Regression risk:** Mitigated by running tests after each batch. The disposables-only batch (76% of files) is nearly zero-risk.
- **`runtimeSession.test.ts` complexity:** 55 tests with closure-captured variables. Mitigated by careful find-and-replace of `instantiationService` -> `ctx.instantiationService` and `disposables` -> `ctx.disposables`.
- **Notebook preset param:** New API surface, but it's additive (no breaking changes) and only used by 3 files.
