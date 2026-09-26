/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookService } from '../../browser/positronNotebookService.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCodeCell, CellSelectionStatus, NotebookCellOutputs } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import {
	createNotebook,
	deleteNotebookCellsCommand,
	getNotebookCells,
	insertNotebookCell,
	runNotebookCellsCommand,
	updateNotebookCell,
} from '../../browser/positronNotebookAgentCommands.js';

const NOTEBOOK_PATH = '/test/notebook.ipynb';
const NOTEBOOK_URI = URI.file(NOTEBOOK_PATH);

function createCodeCell(overrides: Partial<IPositronNotebookCodeCell> = {}): IPositronNotebookCodeCell {
	return stubInterface<IPositronNotebookCodeCell>({
		isCodeCell: (() => true) as IPositronNotebookCodeCell['isCodeCell'],
		isMarkdownCell: (() => false) as unknown as IPositronNotebookCodeCell['isMarkdownCell'],
		kind: CellKind.Code,
		index: 0,
		uri: URI.parse('file:///test/notebook.ipynb#cell-0'),
		getContent: () => 'print(1)',
		outputs: constObservable([]),
		selectionStatus: constObservable(CellSelectionStatus.Unselected) as IPositronNotebookCodeCell['selectionStatus'],
		executionStatus: constObservable('idle') as IPositronNotebookCodeCell['executionStatus'],
		lastExecutionOrder: constObservable(undefined),
		lastRunSuccess: constObservable(undefined),
		lastExecutionDuration: constObservable(undefined),
		lastRunEndTime: constObservable(undefined),
		...overrides,
	});
}

describe('positronNotebookAgentCommands', () => {
	const ctx = createTestContainer().build();

	/** Registers a notebook instance as the one open at NOTEBOOK_URI. */
	function stubTargetNotebook(instance: IPositronNotebookInstance) {
		ctx.instantiationService.stub(IPositronNotebookService, stubInterface<IPositronNotebookService>({
			listInstances: (uri?: URI) => uri && uri.toString() === NOTEBOOK_URI.toString() ? [instance] : [],
		}));
		ctx.instantiationService.stub(IEditorService, stubInterface<IEditorService>({ activeEditorPane: undefined }));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ foregroundSession: undefined }));
	}

	/** Registers that no notebook is open anywhere. */
	function stubNoNotebookOpen() {
		ctx.instantiationService.stub(IPositronNotebookService, stubInterface<IPositronNotebookService>({ listInstances: () => [] }));
		ctx.instantiationService.stub(IEditorService, stubInterface<IEditorService>({ activeEditorPane: undefined, getEditors: () => [] }));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ foregroundSession: undefined }));
	}

	describe('getNotebookCells', () => {
		it('reports no matching notebook', async () => {
			stubNoNotebookOpen();

			expect(await getNotebookCells(ctx.instantiationService, { path: NOTEBOOK_PATH })).toEqual({
				ok: false,
				error: 'No matching Positron notebook is open. Pass a path to an open notebook, or omit it to target the active one.',
			});
		});

		it('reads every cell when cellIndices is omitted', async () => {
			const cell0 = createCodeCell({ index: 0 });
			const cell1 = createCodeCell({ index: 1, getContent: () => 'print(2)' });
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({ uri: NOTEBOOK_URI, cells: constObservable([cell0, cell1]) }));

			const result = await getNotebookCells(ctx.instantiationService, { path: NOTEBOOK_PATH }) as { ok: true; cellCount: number; cells: Array<{ index: number }> };

			expect(result.ok).toBe(true);
			expect(result.cellCount).toBe(2);
			expect(result.cells.map(c => c.index)).toEqual([0, 1]);
		});

		it('filters to the requested cellIndices', async () => {
			const cell0 = createCodeCell({ index: 0 });
			const cell1 = createCodeCell({ index: 1 });
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({ uri: NOTEBOOK_URI, cells: constObservable([cell0, cell1]) }));

			const result = await getNotebookCells(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndices: [1] }) as { cells: Array<{ index: number }> };

			expect(result.cells.map(c => c.index)).toEqual([1]);
		});

		it('attaches text-only outputs when includeOutputs is set', async () => {
			const outputs = constObservable([stubInterface<NotebookCellOutputs>({
				outputId: 'o1',
				outputs: [
					{ mime: 'text/plain', data: VSBuffer.fromString('42') },
					{ mime: 'image/png', data: VSBuffer.fromString('raw') },
				],
			})]);
			const cell = createCodeCell({ index: 0, outputs });
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({ uri: NOTEBOOK_URI, cells: constObservable([cell]) }));
			ctx.instantiationService.stub(ILogService, stubInterface<ILogService>());

			const result = await getNotebookCells(ctx.instantiationService, { path: NOTEBOOK_PATH, includeOutputs: true }) as { cells: Array<{ outputs: unknown[] }> };

			expect(result.cells[0].outputs).toEqual([{ mimeType: 'text/plain', data: '42' }]);
		});
	});

	describe('insertNotebookCell', () => {
		it('requires cellType and content', async () => {
			stubNoNotebookOpen();
			const incompleteArgs: Partial<Parameters<typeof insertNotebookCell>[1]> = { path: NOTEBOOK_PATH };

			expect(await insertNotebookCell(ctx.instantiationService, incompleteArgs as Parameters<typeof insertNotebookCell>[1])).toEqual({
				ok: false,
				error: 'cellType and content are required.',
			});
		});

		it('reports no matching notebook before touching args further', async () => {
			stubNoNotebookOpen();

			expect(await insertNotebookCell(ctx.instantiationService, { path: NOTEBOOK_PATH, cellType: 'code', content: 'x = 1' })).toEqual({
				ok: false,
				error: 'No matching Positron notebook is open. Pass a path to an open notebook, or omit it to target the active one.',
			});
		});

		it('inserts a cell without running it', async () => {
			const addCell = vi.fn();
			const handleAssistantCellModification = vi.fn(async () => undefined);
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({
				uri: NOTEBOOK_URI,
				cells: constObservable([]),
				setCurrentOperation: vi.fn(),
				addCell,
				handleAssistantCellModification,
			}));

			const result = await insertNotebookCell(ctx.instantiationService, { path: NOTEBOOK_PATH, cellType: 'markdown', content: '# hi' });

			expect(result).toEqual({ ok: true, index: 0 });
			expect(addCell).toHaveBeenCalledWith(CellKind.Markup, 0, false, '# hi');
		});

		it('inserts and runs a code cell, returning its outputs', async () => {
			const insertedCell = createCodeCell({
				index: 0,
				select: vi.fn(),
				outputs: constObservable([stubInterface<NotebookCellOutputs>({
					outputId: 'o1',
					outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('hi') }],
				})]),
			});
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({
				uri: NOTEBOOK_URI,
				cells: constObservable([insertedCell]),
				setCurrentOperation: vi.fn(),
				addCell: vi.fn(),
				runCells: vi.fn(async () => undefined),
				handleAssistantCellModification: vi.fn(async () => undefined),
			}));
			ctx.instantiationService.stub(ILogService, stubInterface<ILogService>());

			// The stub instance does not really mutate its cell list on addCell, so
			// cells already reflects the post-insert state at the index we pass in.
			const result = await insertNotebookCell(ctx.instantiationService, { path: NOTEBOOK_PATH, cellType: 'code', content: 'print(1)', index: 0, run: true });

			expect(result).toEqual({ ok: true, index: 0, ran: true, outputs: [{ mimeType: 'text/plain', data: 'hi' }] });
		});

		it('does not run a markdown cell even when run is set', async () => {
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({
				uri: NOTEBOOK_URI,
				cells: constObservable([]),
				setCurrentOperation: vi.fn(),
				addCell: vi.fn(),
				handleAssistantCellModification: vi.fn(async () => undefined),
			}));

			const result = await insertNotebookCell(ctx.instantiationService, { path: NOTEBOOK_PATH, cellType: 'markdown', content: '# hi', run: true });

			expect(result).toEqual({ ok: true, index: 0 });
		});
	});

	describe('updateNotebookCell', () => {
		it('requires cellIndex and content', async () => {
			stubNoNotebookOpen();
			const incompleteArgs: Partial<Parameters<typeof updateNotebookCell>[1]> = { path: NOTEBOOK_PATH };

			expect(await updateNotebookCell(ctx.instantiationService, incompleteArgs as Parameters<typeof updateNotebookCell>[1])).toEqual({
				ok: false,
				error: 'cellIndex and content are required.',
			});
		});

		it('reports the out-of-range cell index', async () => {
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({ uri: NOTEBOOK_URI, cells: constObservable([]) }));

			const result = await updateNotebookCell(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndex: 0, content: 'new' });

			expect(result).toEqual({ ok: false, error: 'Cell not found at index: 0' });
		});
	});

	describe('deleteNotebookCellsCommand', () => {
		it('requires a non-empty cellIndices array', async () => {
			stubNoNotebookOpen();

			expect(await deleteNotebookCellsCommand(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndices: [] })).toEqual({
				ok: false,
				error: 'cellIndices must be a non-empty array.',
			});
		});

		it('deletes the requested cells', async () => {
			const model = stubInterface<IPositronNotebookCodeCell['model']>({
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [],
				metadata: {},
				internalMetadata: {},
				collapseState: undefined,
			});
			const cell0 = createCodeCell({ index: 0, model });
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({
				uri: NOTEBOOK_URI,
				cells: constObservable([cell0]),
				deleteCells: vi.fn(),
				addDeletionSentinel: vi.fn(),
				handleAssistantCellModification: vi.fn(async () => undefined),
			}));

			expect(await deleteNotebookCellsCommand(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndices: [0] })).toEqual({ ok: true });
		});
	});

	describe('runNotebookCellsCommand', () => {
		it('requires a non-empty cellIndices array', async () => {
			stubNoNotebookOpen();

			expect(await runNotebookCellsCommand(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndices: [] })).toEqual({
				ok: false,
				error: 'cellIndices must be a non-empty array.',
			});
		});

		it('reports when none of the requested indices are valid', async () => {
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({ uri: NOTEBOOK_URI, cells: constObservable([]) }));

			const result = await runNotebookCellsCommand(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndices: [3] });

			expect(result).toEqual({ ok: false, error: 'No cells found with indices: 3' });
		});

		it('runs the requested cells and returns their outputs', async () => {
			const cell = createCodeCell({
				index: 0,
				select: vi.fn(),
				outputs: constObservable([stubInterface<NotebookCellOutputs>({
					outputId: 'o1',
					outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('42') }],
				})]),
			});
			stubTargetNotebook(stubInterface<IPositronNotebookInstance>({
				uri: NOTEBOOK_URI,
				cells: constObservable([cell]),
				runCells: vi.fn(async () => undefined),
				handleAssistantCellModification: vi.fn(async () => undefined),
			}));
			ctx.instantiationService.stub(ILogService, stubInterface<ILogService>());

			const result = await runNotebookCellsCommand(ctx.instantiationService, { path: NOTEBOOK_PATH, cellIndices: [0] });

			expect(result).toEqual({ ok: true, results: [{ index: 0, outputs: [{ mimeType: 'text/plain', data: '42' }] }] });
		});
	});

	describe('createNotebook', () => {
		it('requires path and language', async () => {
			const incompleteArgs: Partial<Parameters<typeof createNotebook>[1]> = { path: NOTEBOOK_PATH };

			expect(await createNotebook(ctx.instantiationService, incompleteArgs as Parameters<typeof createNotebook>[1])).toEqual({
				ok: false,
				error: 'path and language are required.',
			});
		});

		it('rejects a path without a .ipynb extension', async () => {
			const result = await createNotebook(ctx.instantiationService, { path: '/test/notebook.txt', language: 'python' });

			expect(result).toEqual({ ok: false, error: 'File must have a .ipynb extension: /test/notebook.txt' });
		});

		it('reports no workspace folder is open', async () => {
			ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<IWorkspaceContextService>({
				getWorkspace: () => ({ folders: [], id: 'w', transient: false }),
			}));

			const result = await createNotebook(ctx.instantiationService, { path: 'notebook.ipynb', language: 'python' });

			expect(result).toEqual({ ok: false, error: 'No local workspace folder is available.' });
		});

		it('reports the file already existing', async () => {
			const folder = { uri: URI.file('/test'), name: 'test', index: 0, toResource: (relativePath: string) => URI.joinPath(URI.file('/test'), relativePath) };
			ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<IWorkspaceContextService>({
				getWorkspace: () => ({ folders: [folder], id: 'w', transient: false }),
			}));
			ctx.instantiationService.stub(IFileService, stubInterface<IFileService>({ exists: async () => true }));

			const result = await createNotebook(ctx.instantiationService, { path: 'notebook.ipynb', language: 'python' });

			expect(result).toEqual({ ok: false, error: 'File already exists: notebook.ipynb' });
		});

		it('writes the notebook, opens it, and reports success once the instance registers', async () => {
			const folder = { uri: URI.file('/test'), name: 'test', index: 0, toResource: (relativePath: string) => URI.joinPath(URI.file('/test'), relativePath) };
			ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<IWorkspaceContextService>({
				getWorkspace: () => ({ folders: [folder], id: 'w', transient: false }),
			}));
			const writeFile = vi.fn(async (_resource: URI, _content: VSBuffer) => undefined);
			ctx.instantiationService.stub(IFileService, stubInterface<IFileService>({
				exists: async () => false,
				writeFile: writeFile as unknown as IFileService['writeFile'],
			}));
			const onDidAddNotebookInstance = new Emitter<IPositronNotebookInstance>();
			ctx.instantiationService.stub(IPositronNotebookService, stubInterface<IPositronNotebookService>({
				onDidAddNotebookInstance: onDidAddNotebookInstance.event,
			}));
			const executeCommand = vi.fn(async (_id: string, uri: URI, _override: string) => {
				onDidAddNotebookInstance.fire(stubInterface<IPositronNotebookInstance>({ uri }));
			});
			ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({
				executeCommand: executeCommand as unknown as ICommandService['executeCommand'],
			}));

			const result = await createNotebook(ctx.instantiationService, { path: 'notebook.ipynb', language: 'r' });

			expect(writeFile).toHaveBeenCalledOnce();
			const written = JSON.parse(writeFile.mock.calls[0][1].toString());
			expect(written.metadata.kernelspec).toEqual({ display_name: 'R', language: 'R', name: 'ir' });
			expect(executeCommand.mock.calls[0][0]).toBe('vscode.openWith');
			expect(executeCommand.mock.calls[0][1].toString()).toBe(URI.file('/test/notebook.ipynb').toString());
			expect(executeCommand.mock.calls[0][2]).toBe('workbench.editor.positronNotebook');
			expect(result).toEqual({ ok: true, path: 'notebook.ipynb', uri: URI.file('/test/notebook.ipynb').toString() });
		});

		// Real 5s wait for the raceTimeout to expire (no fake timers, since raceTimeout
		// races a real setTimeout against the event promise); give the test extra room.
		it('reports the notebook not opening when the instance never registers', async () => {
			const folder = { uri: URI.file('/test'), name: 'test', index: 0, toResource: (relativePath: string) => URI.joinPath(URI.file('/test'), relativePath) };
			ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<IWorkspaceContextService>({
				getWorkspace: () => ({ folders: [folder], id: 'w', transient: false }),
			}));
			ctx.instantiationService.stub(IFileService, stubInterface<IFileService>({
				exists: async () => false,
				writeFile: (async () => undefined) as unknown as IFileService['writeFile'],
			}));
			ctx.instantiationService.stub(IPositronNotebookService, stubInterface<IPositronNotebookService>({
				onDidAddNotebookInstance: new Emitter<IPositronNotebookInstance>().event,
			}));
			ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({
				executeCommand: (async () => undefined) as unknown as ICommandService['executeCommand'],
			}));

			const result = await createNotebook(ctx.instantiationService, { path: 'notebook.ipynb', language: 'python' });

			expect(result).toEqual({
				ok: false,
				error: 'Created the notebook file at notebook.ipynb, but it did not open in the Positron notebook editor.',
			});
		}, 7000);
	});
});
