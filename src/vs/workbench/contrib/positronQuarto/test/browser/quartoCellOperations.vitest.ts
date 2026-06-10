/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { computeDeleteCellEdit, computeInsertCellEdit, computeJoinCellsEdit } from '../../browser/quartoCellOperations.js';

describe('quartoCellOperations', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	/** Build a parsed Quarto document model from the given source. */
	function buildModel(content: string) {
		const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
		ctx.disposables.add(textModel);
		const model = new QuartoDocumentModel(textModel, logService);
		ctx.disposables.add(model);
		return { textModel, model };
	}

	describe('computeDeleteCellEdit', () => {
		it('removes a middle cell and collapses the trailing blank line', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```\n\n```{python}\ny = 2\n```\n\n```{python}\nz = 3\n```\n'
			);

			textModel.applyEdits(computeDeleteCellEdit(textModel, model.cells[1]));

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				x = 1
				\`\`\`

				\`\`\`{python}
				z = 3
				\`\`\`
				"
			`);
		});

		it('removes the last cell without leaving a trailing empty cell', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```\n\n```{python}\ny = 2\n```'
			);

			textModel.applyEdits(computeDeleteCellEdit(textModel, model.cells[1]));

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				x = 1
				\`\`\`
				"
			`);
		});
	});

	describe('computeJoinCellsEdit', () => {
		it('merges only the code, leaving prose between the cells in place', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```\n\nSome prose here.\n\n```{python}\ny = 2\n```\n'
			);

			textModel.applyEdits(computeJoinCellsEdit(textModel, model.cells[0], model.cells[1]));

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				x = 1
				y = 2
				\`\`\`

				Some prose here.
				"
			`);
		});

		it('merges multi-line code with prose between the cells', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```\n\nProse paragraph.\n\n```{python}\ny = 2\nz = 3\n```\n'
			);

			textModel.applyEdits(computeJoinCellsEdit(textModel, model.cells[0], model.cells[1]));

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				x = 1
				y = 2
				z = 3
				\`\`\`

				Prose paragraph.
				"
			`);
		});

		it('gathers cell options at the top and drops duplicates', () => {
			const { textModel, model } = buildModel(
				'```{r}\n#| label: first\n#| echo: false\nx <- 1\n```\n\nProse.\n\n```{r}\n#| label: second\n#| echo: false\n#| fig-width: 3\ny <- 2\n```\n'
			);

			textModel.applyEdits(computeJoinCellsEdit(textModel, model.cells[0], model.cells[1]));

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{r}
				#| label: first
				#| echo: false
				#| label: second
				#| fig-width: 3
				x <- 1
				y <- 2
				\`\`\`

				Prose.
				"
			`);
		});

		it('inserts the merged code when the first cell has no code lines', () => {
			const { textModel, model } = buildModel(
				'```{python}\n```\n\n```{python}\ny = 2\n```\n'
			);

			textModel.applyEdits(computeJoinCellsEdit(textModel, model.cells[0], model.cells[1]));

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				y = 2
				\`\`\`
				"
			`);
		});
	});

	describe('computeInsertCellEdit', () => {
		it('inserts above the first cell at the top of the document', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```\n'
			);

			const { edits, cursorLine } = computeInsertCellEdit(textModel, model.cells[0].language, model.cells[0].startLine);
			textModel.applyEdits(edits);

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}

				\`\`\`

				\`\`\`{python}
				x = 1
				\`\`\`
				"
			`);
			expect(cursorLine).toBe(2);
		});

		it('appends below a cell whose closing fence is the last line', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```'
			);

			// Insert below the only cell: its closing fence is the final line, so
			// the insert line is past the end and the edit appends to the document.
			const { edits, cursorLine } = computeInsertCellEdit(textModel, model.cells[0].language, model.cells[0].endLine + 1);
			textModel.applyEdits(edits);

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				x = 1
				\`\`\`

				\`\`\`{python}

				\`\`\`
				"
			`);
			expect(cursorLine).toBe(6);
		});

		it('reuses the existing blank line between two cells instead of doubling it', () => {
			const { textModel, model } = buildModel(
				'```{python}\nx = 1\n```\n\n```{python}\ny = 2\n```\n'
			);

			// Insert above the second cell. The line above (blank) and the second
			// cell's fence below are already separated, so no extra blank lines.
			const { edits, cursorLine } = computeInsertCellEdit(textModel, model.cells[1].language, model.cells[1].startLine);
			textModel.applyEdits(edits);

			expect(textModel.getValue()).toMatchInlineSnapshot(`
				"\`\`\`{python}
				x = 1
				\`\`\`

				\`\`\`{python}

				\`\`\`

				\`\`\`{python}
				y = 2
				\`\`\`
				"
			`);
			expect(cursorLine).toBe(6);
		});
	});
});
