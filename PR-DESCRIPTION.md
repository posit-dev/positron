# Add collapsible markdown header sections to Positron Notebooks

Addresses https://github.com/posit-dev/positron/issues/10461

### Summary

Markdown cells with headings now fold the section beneath them in the Positron notebook editor, restoring parity with the legacy notebook editor and JupyterLab. Folding semantics follow VS Code notebooks' folding model: a heading of level N owns every following cell up to (but not including) the next heading of level N or higher.

Implementation:

- New `NotebookSectionFoldingModel` (`notebookSectionFolding.ts`), exposed on the notebook instance as `sectionFolding`. Section ranges are derived observables over the cells array and each markdown cell's content (reusing upstream's `getMarkdownHeadersInCell`, so headings inside fenced code blocks don't count), and recompute automatically on cell add/remove/reorder/edit.
- Collapse state is keyed by cell handle: sections survive reorders, and removing the heading text of a collapsed header simply unhides its cells.
- Header cells show a rotating chevron in the left gutter (revealed on hover/selection, always visible while collapsed) and a clickable "N cells hidden" hint below the rendered markdown.
- The view skips hidden cells, add-cell buttons retarget to the first visible position so a new cell isn't inserted hidden, and arrow-key navigation skips hidden cells. Programmatically selecting a hidden cell (e.g. from the outline) auto-expands its containing sections.
- Folding is purely a view concern: hidden cells stay in the model, so Run All and execution ordering are unaffected.

### Screenshots

TODO: add a short recording of collapsing/expanding a header section.

### Release Notes

#### New Features

- Markdown header sections can be collapsed and expanded in the Positron notebook editor (#10461)

#### Bug Fixes

- N/A

### Validation Steps

@:positron-notebooks

1. Open a notebook in the Positron notebook editor with cells: `# Section 1` (markdown), two code cells, `# Section 2` (markdown), one code cell.
2. Hover the "Section 1" cell: a chevron appears in the left gutter. Click it: the two code cells hide and the header shows "2 cells hidden".
3. Click the hint (or the chevron again) to expand.
4. Add a `## Subsection` cell inside a section and verify it folds independently and stays collapsed when the outer section is collapsed and then expanded.
5. With a section collapsed, select the header and press the down arrow: selection skips to the next visible cell.
6. With a section collapsed, Run All: hidden cells still execute.

Unit coverage: `notebookSectionFolding.vitest.ts` (heading detection, fold-range computation, fold model, keyboard navigation skipping) and `sectionFoldButton.vitest.tsx` (chevron collapse/expand, hidden-cell hint).
