# POM Patterns

How to discover, choose, and use Page Object Model methods correctly.

## POM Reference File

Read the per-POM reference files at `test/e2e/tests/_generated/pom-ref/<name>.md` before choosing methods. Each file covers one POM (10-80 lines) with full TypeScript signatures. Read only the POMs you need, in parallel. Do NOT read the monolith `pom-reference.md` (800+ lines).

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

## Context Menus

The runner's `contextMenu` action and saved `.test.ts` files both use the same POM (`app.workbench.contextMenu.triggerAndClick`). This means the same selector rules apply everywhere.

**Always target the content element, not the container.** The POM clicks the center of the matched element. A container (e.g., `.positron-notebook-code-cell-outputs`) and its child content (e.g., the output text) often have **different context menus**. Clicking the container center may land on empty space with the wrong menu, or succeed non-deterministically depending on element size. Target the specific interactive element:

- Output text: `.positron-notebook-code-cell-outputs >> nth=0 >> text=hello world`
- Table row: `.data-grid-row >> nth=2`
- Tab: `text=filename.py`

**In `/run-plan`**, use Playwright selector chaining to narrow to content. **In saved tests**, use the equivalent locator chain (`.locator().getByText()`). Since both paths use the same POM, a precise selector that works in the runner will work in the saved test.

Read `pom-ref/contextMenu.md` for method signatures.

## Known Notebook Pitfalls

**`expectExecutionStatusToBe(index, "success")` doesn't work.** The `data-execution-status` attribute returns to `"idle"` after completion, not `"success"`. Use `expectFooterToContain(index, {"status": "Cell execution succeeded"})` instead.

**`newNotebook({codeCells: N})` is flaky for N >= 2.** The placeholder text check ("# Cell 1") times out because the text isn't fully rendered within the 2000ms internal timeout. Workaround: create with `codeCells: 0` (or omit), then add cells manually via `addCell("code")`.

**Kernel may not connect after `newNotebook`.** The quickpicker selects the language but the kernel doesn't fully start. Cells "execute" (show success footer) but produce no output. Use `newNotebook({language: "Python", waitForReady: true})` and verify output before proceeding -- if output is missing, the kernel didn't connect.

## Clipboard Verification

**Always verify clipboard contents after copy actions.** Use the `clipboard` POM (`pom-ref/clipboard.md`) -- never improvise with paste-into-cell or other workarounds.

**Clipboard writes are timing-sensitive.** `expectClipboardTextToBe` retries the read but not the copy action. When the copy action itself may need retrying (context menus, copy-after-selection), wrap both action + assertion in `expect.toPass()` with tight inner timeouts so each retry fails fast. See the `@example` on `expectClipboardTextToBe` in `pages/clipboard.ts`. Key: keep the inner `expectClipboardTextToBe` timeout short (1s) so retries cycle quickly, and use a 10s outer `toPass` timeout.

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
