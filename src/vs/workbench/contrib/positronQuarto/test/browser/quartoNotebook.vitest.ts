/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { NotebookCellType } from '../../../../common/positron/notebookAssistant.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { CellExecutionState, ICellOutput, IQuartoExecutionManager } from '../../common/quartoExecutionTypes.js';
import { QuartoCodeCell } from '../../common/quartoTypes.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { QuartoNotebook } from '../../browser/quartoNotebook.js';
import { IQuartoOutputManager } from '../../browser/quartoOutputManager.js';
import { POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY } from '../../../positronNotebook/common/positronNotebookConfig.js';
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
	const executeCell = vi.fn<(uri: URI, cell: QuartoCodeCell) => Promise<void>>(() => Promise.resolve());
	let outputs: ICellOutput[] = [];
	let foregroundSession: ILanguageRuntimeSession | undefined;
	let affiliatedRuntimes: ILanguageRuntimeMetadata[] = [];
	let activeEditor: ICodeEditor | undefined;
	const configurationService = new TestConfigurationService();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(ICodeEditorService, { listCodeEditors: () => [] })
		.stub(IConfigurationService, configurationService)
		.stub(IEditorService, { get activeTextEditorControl() { return activeEditor; } })
		.stub(IQuartoExecutionManager, {
			executeCell,
			getExecutionState: () => CellExecutionState.Idle,
		})
		.stub(IQuartoKernelManager, { getSessionForDocument: () => undefined })
		.stub(IQuartoOutputManager, { getOutputsForCell: () => outputs })
		.stub(IRuntimeSessionService, { get foregroundSession() { return foregroundSession; } })
		.stub(IRuntimeStartupService, { getAffiliatedRuntimes: () => affiliatedRuntimes })
		.build();

	beforeEach(() => {
		executeCell.mockClear();
		outputs = [];
		foregroundSession = undefined;
		affiliatedRuntimes = [];
		activeEditor = undefined;
		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY, true);
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

	it('takes the language of a document without chunks from the foreground session, then the affiliated runtime', () => {
		const addFirstCell = () => {
			const { notebook, textModel } = createNotebook('Text.\n');
			notebook.addCell(NotebookCellType.Code, 0, 'x');
			return textModel.getValue();
		};
		expect(addFirstCell).toThrow('no language');

		affiliatedRuntimes = [stubInterface<ILanguageRuntimeMetadata>({ languageId: 'python' })];
		expect(addFirstCell()).toBe('Text.\n\n```{python}\nx\n```\n');

		foregroundSession = stubInterface<ILanguageRuntimeSession>({ runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r' }) });
		expect(addFirstCell()).toBe('Text.\n\n```{r}\nx\n```\n');
	});

	it('refuses content that would end the chunk', () => {
		const { notebook } = createNotebook(DOCUMENT);

		expect(() => notebook.updateCellContent(1, 'x <- "\n```\n"')).toThrow('end the chunk');
		notebook.updateCellContent(1, 'x <- "\n  ```{r}\n"');
		expect(notebook.getCell(1)?.content).toBe('x <- "\n  ```{r}\n"');
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

	it('runs the requested cells, refusing any that do not exist', async () => {
		const { notebook } = createNotebook(DOCUMENT);

		await notebook.runCells([1, 0]);
		await expect(notebook.runCells([1, 5])).rejects.toThrow('Cell not found at index: 5');

		expect(executeCell.mock.calls.map(([, cell]) => cell.index)).toEqual([1, 0]);
	});

	it('decodes image outputs and passes text outputs through', async () => {
		const { notebook } = createNotebook(DOCUMENT);
		outputs = [
			{ outputId: '1', items: [{ mime: 'application/vnd.code.notebook.stdout', data: '[1] 2' }] },
			{ outputId: '2', items: [{ mime: 'image/png', data: 'iVBO\nRw0K\n' }] },
		];

		expect(await notebook.getCellOutputs(1)).toEqual([
			{ mimeType: 'application/vnd.code.notebook.stdout', data: '[1] 2' },
			{ mimeType: 'image/png', data: 'iVBORw0K' },
		]);
	});

	it('reveals the cells the assistant edits or runs, unless auto-follow is off', async () => {
		const { notebook, textModel } = createNotebook(DOCUMENT);
		const reveal = vi.fn();
		activeEditor = stubInterface<ICodeEditor>({
			getEditorType: () => EditorType.ICodeEditor,
			getModel: () => textModel,
			revealLinesInCenterIfOutsideViewport: reveal,
		});

		await notebook.runCells([1]);
		notebook.updateCellContent(0, 'x <- 2');
		expect(reveal.mock.calls.map(([start]) => start)).toEqual([13, 7]);

		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY, false);
		notebook.addCell(NotebookCellType.Code, 0, 'y');
		expect(reveal).toHaveBeenCalledTimes(2);
	});
});
