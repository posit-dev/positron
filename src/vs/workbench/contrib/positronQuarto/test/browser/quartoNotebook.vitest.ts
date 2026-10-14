/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NotebookCellType } from '../../../../common/positron/notebookAssistant.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CellExecutionState, ICellOutput, IQuartoExecutionManager } from '../../common/quartoExecutionTypes.js';
import { QuartoCodeCell } from '../../common/quartoTypes.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { QuartoNotebook } from '../../browser/quartoNotebook.js';
import { IQuartoOutputManager } from '../../browser/quartoOutputManager.js';
import { createTestRuntimeStartupService } from './quartoTestRuntimeStartupService.js';

const DOCUMENT = `---
title: "Test"
---

Intro text.

\`\`\`{r}
#| label: setup
x <- 1
\`\`\`


\`\`\`{r}
x + 1
\`\`\`

Closing text.
`;

describe('QuartoNotebook', () => {
	const executeCells = vi.fn<(uri: URI, cells: QuartoCodeCell[]) => Promise<void>>(() => Promise.resolve());
	let outputs: ICellOutput[] = [];

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IEditorService, { activeTextEditorControl: undefined })
		.stub(IQuartoExecutionManager, {
			executeCells,
			getExecutionState: () => CellExecutionState.Idle,
		})
		.stub(IQuartoKernelManager, { getSessionForDocument: () => undefined })
		.stub(IQuartoOutputManager, { getOutputsForCell: () => outputs })
		.build();

	beforeEach(() => {
		executeCells.mockClear();
		outputs = [];
	});

	function createNotebook(content: string) {
		const textModel = ctx.disposables.add(createTextModel(content, null, undefined, URI.file('/test.qmd')));
		const documentModel = ctx.disposables.add(
			new QuartoDocumentModel(textModel, new NullLogService(), createTestRuntimeStartupService()));
		const notebook = ctx.instantiationService.createInstance(QuartoNotebook, textModel, documentModel);
		return { notebook, textModel };
	}

	it('presents the code chunks as cells', () => {
		const { notebook } = createNotebook(DOCUMENT);

		expect(notebook.getCells().map(cell => [cell.index, cell.content])).toEqual([
			[0, '#| label: setup\nx <- 1'],
			[1, 'x + 1'],
		]);
	});

	it('inserts a chunk in the primary language before a cell, or appends it', () => {
		const { notebook, textModel } = createNotebook(DOCUMENT);

		expect(notebook.addCell(NotebookCellType.Code, 1, 'z <- 3\n')).toBe(1);
		expect(notebook.addCell(NotebookCellType.Code, 99, 'z')).toBe(3);

		expect(textModel.getValue()).toBe(DOCUMENT
			.replace('```{r}\nx + 1', '```{r}\nz <- 3\n```\n\n```{r}\nx + 1')
			.replace('Closing text.\n', 'Closing text.\n\n```{r}\nz\n```\n'));
	});

	it('refuses to add a markdown cell', () => {
		const { notebook } = createNotebook(DOCUMENT);

		expect(() => notebook.addCell(NotebookCellType.Markdown, 0, 'Prose.')).toThrow('text tools');
	});

	it('deletes several cells as one undoable edit', () => {
		const { notebook, textModel } = createNotebook(DOCUMENT);

		notebook.deleteCells([0, 1]);
		expect(textModel.getValue()).toBe('---\ntitle: "Test"\n---\n\nIntro text.\n\n\nClosing text.\n');

		textModel.undo();
		expect(textModel.getValue()).toBe(DOCUMENT);
	});

	it('runs the requested cells', async () => {
		const { notebook } = createNotebook(DOCUMENT);

		await notebook.runCells([1, 5]);

		expect(executeCells.mock.calls.map(([, cells]) => cells.map(cell => cell.index))).toEqual([[1]]);
		await expect(notebook.runCells([5])).rejects.toThrow('No cells found');
	});

	it('decodes image outputs and passes text outputs through', async () => {
		const { notebook } = createNotebook(DOCUMENT);
		outputs = [
			{ outputId: '1', items: [{ mime: 'application/vnd.code.notebook.stdout', data: '[1] 2' }] },
			{ outputId: '2', items: [{ mime: 'image/png', data: 'iVBORw0K' }] },
		];

		expect(await notebook.getCellOutputs(1)).toEqual([
			{ mimeType: 'application/vnd.code.notebook.stdout', data: '[1] 2' },
			{ mimeType: 'image/png', data: 'iVBORw0K' },
		]);
	});
});
