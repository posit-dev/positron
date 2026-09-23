/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { NotebookCellType } from '../../../../common/positron/notebookAssistant.js';
import { IPositronNotebookService } from '../../browser/positronNotebookService.js';
import { IPositronNotebookInstance, NotebookOperationType } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell, IPositronNotebookCodeCell, IPositronNotebookMarkdownCell, CellSelectionStatus, NotebookCellOutputs } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../common/positronNotebookCommon.js';
import {
	addNotebookCell,
	collectCellOutputDTOs,
	deleteNotebookCells,
	mapCellToDTO,
	resolveNotebookInstance,
	runNotebookCells,
	updateNotebookCellContent,
} from '../../browser/notebookAgentOperations.js';

function createCodeCell(overrides: Partial<IPositronNotebookCodeCell> = {}): IPositronNotebookCodeCell {
	return stubInterface<IPositronNotebookCodeCell>({
		isCodeCell: (() => true) as IPositronNotebookCodeCell['isCodeCell'],
		isMarkdownCell: (() => false) as unknown as IPositronNotebookCodeCell['isMarkdownCell'],
		kind: CellKind.Code,
		index: 0,
		uri: URI.parse('file:///test/notebook.ipynb#cell-0'),
		getContent: () => 'print("hi")',
		outputs: constObservable([]),
		selectionStatus: constObservable(CellSelectionStatus.Unselected) as IPositronNotebookCodeCell['selectionStatus'],
		executionStatus: constObservable('idle') as IPositronNotebookCodeCell['executionStatus'],
		lastExecutionOrder: constObservable(1),
		lastRunSuccess: constObservable(true),
		lastExecutionDuration: constObservable(12),
		lastRunEndTime: constObservable(1000),
		...overrides,
	});
}

describe('mapCellToDTO', () => {
	it('maps a code cell, including execution fields', () => {
		const cell = createCodeCell();

		const dto = mapCellToDTO(cell);

		expect(dto).toEqual({
			id: 'file:///test/notebook.ipynb#cell-0',
			index: 0,
			type: NotebookCellType.Code,
			content: 'print("hi")',
			hasOutput: false,
			selectionStatus: 'unselected',
			executionStatus: 'idle',
			executionOrder: 1,
			lastRunSuccess: true,
			lastExecutionDuration: 12,
			lastRunEndTime: 1000,
		});
	});

	it('maps the editing selection status to active', () => {
		const cell = createCodeCell({ selectionStatus: constObservable(CellSelectionStatus.Editing) as IPositronNotebookCodeCell['selectionStatus'] });

		expect(mapCellToDTO(cell).selectionStatus).toBe('active');
	});

	it('maps a markdown cell, including editorShown but no execution fields', () => {
		const cell = stubInterface<IPositronNotebookMarkdownCell>({
			isCodeCell: (() => false) as IPositronNotebookMarkdownCell['isCodeCell'],
			isMarkdownCell: (() => true) as unknown as IPositronNotebookMarkdownCell['isMarkdownCell'],
			kind: CellKind.Markup,
			index: 1,
			uri: URI.parse('file:///test/notebook.ipynb#cell-1'),
			getContent: () => '# heading',
			selectionStatus: constObservable(CellSelectionStatus.Selected) as IPositronNotebookMarkdownCell['selectionStatus'],
			editorShown: constObservable(false),
		});

		const dto = mapCellToDTO(cell);

		expect(dto).toEqual({
			id: 'file:///test/notebook.ipynb#cell-1',
			index: 1,
			type: NotebookCellType.Markdown,
			content: '# heading',
			hasOutput: false,
			selectionStatus: 'selected',
			editorShown: false,
		});
	});
});

describe('collectCellOutputDTOs', () => {
	function createOutputCell(outputItems: { mime: string; data: VSBuffer }[]): IPositronNotebookCodeCell {
		return createCodeCell({
			outputs: constObservable([stubInterface<NotebookCellOutputs>({ outputId: 'output-1', outputs: outputItems })]),
		});
	}

	it('passes through a text output as-is', async () => {
		const cell = createOutputCell([{ mime: 'text/plain', data: VSBuffer.fromString('42') }]);

		const outputs = await collectCellOutputDTOs(cell, stubInterface<ILogService>(), { textOnly: false });

		expect(outputs).toEqual([{ mimeType: 'text/plain', data: '42' }]);
	});

	it('prefixes a stderr output', async () => {
		const cell = createOutputCell([{ mime: 'application/vnd.code.notebook.stderr', data: VSBuffer.fromString('boom') }]);

		const outputs = await collectCellOutputDTOs(cell, stubInterface<ILogService>(), { textOnly: false });

		expect(outputs).toEqual([{ mimeType: 'application/vnd.code.notebook.stderr', data: '[stderr] boom' }]);
	});

	it('base64-encodes an image output', async () => {
		const cell = createOutputCell([{ mime: 'image/png', data: VSBuffer.fromString('rawbytes') }]);

		const outputs = await collectCellOutputDTOs(cell, stubInterface<ILogService>(), { textOnly: false });

		expect(outputs).toEqual([{ mimeType: 'image/png', data: Buffer.from('rawbytes').toString('base64') }]);
	});

	it('excludes image outputs when textOnly is set, keeping text outputs from the same cell', async () => {
		const cell = createOutputCell([
			{ mime: 'text/plain', data: VSBuffer.fromString('42') },
			{ mime: 'image/png', data: VSBuffer.fromString('rawbytes') },
		]);

		const outputs = await collectCellOutputDTOs(cell, stubInterface<ILogService>(), { textOnly: true });

		expect(outputs).toEqual([{ mimeType: 'text/plain', data: '42' }]);
	});

	it('returns no outputs for a markdown (non-code) cell', async () => {
		const cell = stubInterface<IPositronNotebookCell>({
			isCodeCell: (() => false) as IPositronNotebookCell['isCodeCell'],
		});

		expect(await collectCellOutputDTOs(cell, stubInterface<ILogService>(), { textOnly: false })).toEqual([]);
	});
});

describe('resolveNotebookInstance', () => {
	createTestContainer().build();

	function createNotebookInstance(uriString: string): IPositronNotebookInstance {
		return stubInterface<IPositronNotebookInstance>({ uri: URI.parse(uriString) });
	}

	it('resolves the instance matching an explicit notebookUri', () => {
		const target = createNotebookInstance('file:///test/target.ipynb');
		const other = createNotebookInstance('file:///test/other.ipynb');
		const notebookService = stubInterface<IPositronNotebookService>({
			listInstances: (uri?: URI) => [target, other].filter(i => !uri || i.uri.toString() === uri.toString()),
		});

		const resolved = resolveNotebookInstance(
			notebookService,
			stubInterface<IEditorService>({ activeEditorPane: undefined }),
			stubInterface<IRuntimeSessionService>(),
			'file:///test/target.ipynb',
		);

		expect(resolved).toBe(target);
	});

	it('falls back to the foreground session\'s notebook when nothing is the active editor', () => {
		const attached = createNotebookInstance('file:///test/attached.ipynb');
		const notebookService = stubInterface<IPositronNotebookService>({
			listInstances: (uri?: URI) => uri && uri.toString() === attached.uri.toString() ? [attached] : [],
		});
		const editorService = stubInterface<IEditorService>({
			activeEditorPane: undefined,
			getEditors: () => [],
		});
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({
			foregroundSession: stubInterface<ILanguageRuntimeSession>({
				metadata: stubInterface<IRuntimeSessionMetadata>({ notebookUri: attached.uri }),
			}),
		});

		const resolved = resolveNotebookInstance(notebookService, editorService, runtimeSessionService, undefined);

		expect(resolved).toBe(attached);
	});

	it('falls back to the most recently active Positron notebook editor when there is no foreground session', () => {
		const recent = createNotebookInstance('file:///test/recent.ipynb');
		const notebookService = stubInterface<IPositronNotebookService>({
			listInstances: (uri?: URI) => uri && uri.toString() === recent.uri.toString() ? [recent] : [],
		});
		const editorInput = stubInterface<EditorInput>({ typeId: POSITRON_NOTEBOOK_EDITOR_INPUT_ID, resource: recent.uri });
		const editorService = stubInterface<IEditorService>({
			activeEditorPane: undefined,
			getEditors: (order: EditorsOrder) => order === EditorsOrder.MOST_RECENTLY_ACTIVE
				? [{ groupId: 0, editor: editorInput }]
				: [],
		});
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ foregroundSession: undefined });

		const resolved = resolveNotebookInstance(notebookService, editorService, runtimeSessionService, undefined);

		expect(resolved).toBe(recent);
	});

	it('resolves undefined when nothing matches', () => {
		const notebookService = stubInterface<IPositronNotebookService>({ listInstances: () => [] });
		const editorService = stubInterface<IEditorService>({ activeEditorPane: undefined, getEditors: () => [] });
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ foregroundSession: undefined });

		expect(resolveNotebookInstance(notebookService, editorService, runtimeSessionService, undefined)).toBeUndefined();
	});
});

describe('runNotebookCells', () => {
	function createInstance(cells: IPositronNotebookCell[]) {
		const runCells = vi.fn(async () => undefined);
		const handleAssistantCellModification = vi.fn(async () => undefined);
		const instance = stubInterface<IPositronNotebookInstance>({
			cells: constObservable(cells),
			runCells,
			handleAssistantCellModification,
		});
		return { instance, runCells, handleAssistantCellModification };
	}

	it('runs the requested cells and notifies follow mode with the last one', async () => {
		const select0 = vi.fn();
		const select1 = vi.fn();
		const cell0 = createCodeCell({ index: 0, select: select0 });
		const cell1 = createCodeCell({ index: 1, select: select1 });
		const { instance, runCells, handleAssistantCellModification } = createInstance([cell0, cell1]);

		const ran = await runNotebookCells(instance, [0, 1]);

		expect(ran).toEqual([cell0, cell1]);
		expect(select0).not.toHaveBeenCalled();
		expect(select1).toHaveBeenCalledOnce();
		expect(runCells).toHaveBeenCalledWith([cell0, cell1]);
		expect(handleAssistantCellModification).toHaveBeenCalledWith(1);
	});

	it('filters out-of-range indices and runs only the valid ones', async () => {
		const cell0 = createCodeCell({ index: 0, select: vi.fn() });
		const { instance, runCells } = createInstance([cell0]);

		const ran = await runNotebookCells(instance, [0, 5]);

		expect(ran).toEqual([cell0]);
		expect(runCells).toHaveBeenCalledWith([cell0]);
	});

	it('runs nothing and does not touch the instance when every index is invalid', async () => {
		const { instance, runCells, handleAssistantCellModification } = createInstance([]);

		const ran = await runNotebookCells(instance, [0]);

		expect(ran).toEqual([]);
		expect(runCells).not.toHaveBeenCalled();
		expect(handleAssistantCellModification).not.toHaveBeenCalled();
	});
});

describe('addNotebookCell', () => {
	it('marks the operation, inserts the cell, and notifies follow mode', async () => {
		const setCurrentOperation = vi.fn();
		const addCell = vi.fn();
		const handleAssistantCellModification = vi.fn(async () => undefined);
		const instance = stubInterface<IPositronNotebookInstance>({ setCurrentOperation, addCell, handleAssistantCellModification });

		const index = await addNotebookCell(instance, NotebookCellType.Code, 2, 'x = 1');

		expect(setCurrentOperation).toHaveBeenCalledWith(NotebookOperationType.AssistantAdd);
		expect(addCell).toHaveBeenCalledWith(CellKind.Code, 2, false, 'x = 1');
		expect(handleAssistantCellModification).toHaveBeenCalledWith(2, 'add');
		expect(index).toBe(2);
	});

	it('maps a markdown cell to CellKind.Markup', async () => {
		const addCell = vi.fn();
		const instance = stubInterface<IPositronNotebookInstance>({
			setCurrentOperation: vi.fn(),
			addCell,
			handleAssistantCellModification: vi.fn(async () => undefined),
		});

		await addNotebookCell(instance, NotebookCellType.Markdown, 0, '# hi');

		expect(addCell).toHaveBeenCalledWith(CellKind.Markup, 0, false, '# hi');
	});
});

describe('deleteNotebookCells', () => {
	it('reports the out-of-range index without deleting anything', async () => {
		const deleteCells = vi.fn();
		const instance = stubInterface<IPositronNotebookInstance>({
			cells: constObservable([createCodeCell({ index: 0 })]),
			deleteCells,
		});

		const result = await deleteNotebookCells(instance, [5]);

		expect(result).toEqual({ ok: false, error: 'Cell not found at index: 5' });
		expect(deleteCells).not.toHaveBeenCalled();
	});

	it('deletes the given cells and notifies follow mode with the lowest index', async () => {
		const cellModel = stubInterface<IPositronNotebookCodeCell['model']>({
			language: 'python',
			mime: undefined,
			cellKind: CellKind.Code,
			outputs: [],
			metadata: {},
			internalMetadata: {},
			collapseState: undefined,
		});
		const cell0 = createCodeCell({ index: 0, model: cellModel });
		const cell1 = createCodeCell({ index: 1, model: cellModel });
		const deleteCells = vi.fn();
		const addDeletionSentinel = vi.fn();
		const handleAssistantCellModification = vi.fn(async () => undefined);
		const instance = stubInterface<IPositronNotebookInstance>({
			cells: constObservable([cell0, cell1]),
			deleteCells,
			addDeletionSentinel,
			handleAssistantCellModification,
		});

		const result = await deleteNotebookCells(instance, [0, 1]);

		expect(result).toEqual({ ok: true });
		expect(deleteCells).toHaveBeenCalledWith([cell0, cell1]);
		// Sentinels are recorded highest index first so earlier deletions don't shift later ones.
		expect(addDeletionSentinel.mock.calls.map(call => call[0])).toEqual([1, 0]);
		expect(handleAssistantCellModification).toHaveBeenCalledWith(0, 'delete');
	});
});

describe('updateNotebookCellContent', () => {
	it('reports the out-of-range index without touching the text model', async () => {
		const instance = stubInterface<IPositronNotebookInstance>({
			cells: constObservable([createCodeCell({ index: 0 })]),
		});

		const result = await updateNotebookCellContent(instance, 5, 'new content');

		expect(result).toEqual({ ok: false, error: 'Cell not found at index: 5' });
	});

	it('reports a missing text model', async () => {
		const cell = createCodeCell({ index: 0, model: stubInterface<IPositronNotebookCodeCell['model']>() });
		const instance = stubInterface<IPositronNotebookInstance>({
			cells: constObservable([cell]),
			uri: URI.parse('file:///test/notebook.ipynb'),
			textModel: undefined,
		});

		const result = await updateNotebookCellContent(instance, 0, 'new content');

		expect(result).toEqual({ ok: false, error: 'No text model found for notebook: file:///test/notebook.ipynb' });
	});
});
