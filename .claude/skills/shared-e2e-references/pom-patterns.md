# POM Patterns

How to discover, choose, and use Page Object Model methods correctly.

## POM Reference File

Always read `test/e2e/tests/_generated/pom-reference.md` before choosing methods. It auto-generates from POM source files with full TypeScript signatures.

**Check staleness:** If any file in `test/e2e/pages/` is newer than the reference, regenerate:

```bash
REF=test/e2e/tests/_generated/pom-reference.md
if [ ! -f "$REF" ] || [ -n "$(find test/e2e/pages -name '*.ts' -newer "$REF" 2>/dev/null | head -1)" ]; then
  npx tsx scripts/generate-pom-reference.ts
fi
```

## Method Name Accuracy

**Copy-paste method names from the reference. NEVER abbreviate, shorten, or paraphrase.**

- The method is `openVariableInDataExplorer`, not `doubleClickVariable`
- The method is `waitForPlotInFullSizeViewer`, not `waitForFullSizeViewer`
- The method is `deleteAllVariables`, not `clickDeleteAllVariables`

If you are not 100% certain of the exact method name, grep the reference before using it.

## Read the Description

Read the `--` description after each method signature before choosing it. The description tells you WHEN to use the method. If it says "See also: X", read X too.

## Common Confusable Methods

| Wrong / Unreliable | Correct | Why |
|---------------------|---------|-----|
| `clickDatabaseIconForVariableRow` | `openVariableInDataExplorer` | The icon click is unreliable; `openVariableInDataExplorer` is the stable method |
| `waitForCurrentPlot` | `waitForPlotInFullSizeViewer` | `waitForCurrentPlot` is for the sidebar thumbnail; use the full-size variant for the editor viewer |
| `clickDeleteAllVariables` | `deleteAllVariables` | `clickDeleteAllVariables` only clicks the button; `deleteAllVariables` also handles the confirmation dialog |
| `clickText('Section Title')` | `outline.clickOutlineElement('Section Title')` | `clickText` matches both outline tree AND rendered content (e.g., an `<h1>` in a notebook); use the scoped POM method |

## Quote Normalization in expectVariableToBe

Python displays string variables with single quotes (`'hello'`), R with double quotes (`"hello"`). The `expectVariableToBe` POM normalizes automatically -- pass the value with either quote style and it matches both.

## POM-First Rule

Never use raw selectors, `evaluate`, or screenshots for verification when a POM `expect*` or `waitFor*` method exists. These POM assertion methods have built-in retries and proper wait logic.

Raw actions (`snapshot`, `takeScreenshot`, `clickSelector`) are for **debugging failures**, not for primary assertions or interactions.

Before writing a raw locator, check the POM reference for an existing method that covers the intent.

## Reading POM Source

POM source files live in `test/e2e/pages/`. Read them directly when you need:

- Union type definitions or complex parameter shapes beyond what the reference shows
- Implementation details for understanding retry behavior
- Available methods on sub-objects (e.g., `dataExplorer.grid`, `dataExplorer.summaryPanel`)

## POM Access Pattern

Access POMs through `app.workbench.*`:

```typescript
const { console, variables, dataExplorer, plots, notebooks, sessions } = app.workbench;
```

For sub-objects, chain the access:

```typescript
await app.workbench.dataExplorer.grid.verifyTableData([...]);
await app.workbench.dataExplorer.summaryPanel.expectColumnCount(5);
```
