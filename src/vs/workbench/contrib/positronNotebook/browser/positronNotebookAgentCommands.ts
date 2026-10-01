/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Event } from '../../../../base/common/event.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotebookCellDTO, NotebookCellType } from '../../../common/positron/notebookAssistant.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import {
	addNotebookCell,
	collectCellOutputDTOs,
	deleteNotebookCells,
	mapCellToDTO,
	resolveNotebookInstance,
	runNotebookCells,
	updateNotebookCellContent,
} from './notebookAgentOperations.js';

/**
 * Agent-callable notebook commands: create/read/edit/run cells of a live
 * Jupyter notebook via `positron.notebooks.*`'s underlying operations
 * (`notebookAgentOperations.ts`), flagged `agentCompatible` so MCP
 * (`run_positron_command`) and Assistant's generic `positronCommand` tool can
 * discover and call them with no further code on either side.
 *
 * Registered through CommandsRegistry rather than registerAction2, so none
 * takes a Command Palette slot -- running one directly would show the user
 * nothing useful -- and none has a precondition, matching every other
 * agentCompatible payload command in the workbench (see
 * positronDataConnectionsCommands.ts, positronPackagesCommands.ts). A
 * precondition of "notebook is the active editor" would be wrong here: a
 * notebook addressed by `path` can be open without being the active editor
 * pane, a case `notebookAgentOperations.ts`'s `resolveNotebookInstance`
 * already handles. Unavailability (no matching notebook, bad index) is
 * reported in the payload instead.
 *
 * Not gated on the ai.enabled main switch, for the same reason as every other
 * agentCompatible command: it drives discovery, not model calls, and the
 * calling agent surface is itself already gated on ai.enabled.
 */

/** How long `create` waits for the newly opened notebook to register itself. */
const CREATE_TIMEOUT_MS = 5000;

type NotebookLanguage = 'python' | 'r';

const KERNELSPECS: Record<NotebookLanguage, { display_name: string; language: string; name: string }> = {
	python: { display_name: 'Python 3', language: 'python', name: 'python3' },
	r: { display_name: 'R', language: 'R', name: 'ir' },
};

interface CreateArgs {
	path: string;
	language: NotebookLanguage;
}

export async function createNotebook(accessor: ServicesAccessor, args: CreateArgs): Promise<object> {
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const fileService = accessor.get(IFileService);
	const commandService = accessor.get(ICommandService);
	const positronNotebookService = accessor.get(IPositronNotebookService);

	if (!args?.path || !args.language) {
		return { ok: false, error: 'path and language are required.' };
	}
	if (!args.path.endsWith('.ipynb')) {
		return { ok: false, error: `File must have a .ipynb extension: ${args.path}` };
	}

	const folder = workspaceContextService.getWorkspace().folders[0];
	if (!folder) {
		return { ok: false, error: 'No local workspace folder is available.' };
	}

	const fileUri = URI.joinPath(folder.uri, args.path);

	if (await fileService.exists(fileUri)) {
		return { ok: false, error: `File already exists: ${args.path}` };
	}

	const kernelspec = KERNELSPECS[args.language];
	const notebook = {
		cells: [],
		metadata: { kernelspec, language_info: { name: kernelspec.language } },
		nbformat: 4,
		nbformat_minor: 5,
	};
	await fileService.writeFile(fileUri, VSBuffer.fromString(JSON.stringify(notebook, null, 2) + '\n'));

	const disposables = new DisposableStore();
	const opened = raceTimeout(
		Event.toPromise(
			Event.filter(positronNotebookService.onDidAddNotebookInstance, instance => isEqual(instance.uri, fileUri)),
			disposables,
		),
		CREATE_TIMEOUT_MS,
	);
	await commandService.executeCommand('vscode.openWith', fileUri, POSITRON_NOTEBOOK_EDITOR_ID);
	const instance = await opened;
	disposables.dispose();

	if (!instance) {
		return {
			ok: false,
			error: `Created the notebook file at ${args.path}, but it did not open in the Positron notebook editor.`,
		};
	}

	return { ok: true, path: args.path, uri: fileUri.toString() };
}

interface TargetedArgs {
	path?: string;
}

/**
 * Resolve a path an agent passed (workspace-relative, since that's the only
 * form an agent can reasonably discover, or already-absolute) to the URI a
 * live notebook instance is registered under.
 */
function resolvePathToUri(accessor: ServicesAccessor, path: string): URI {
	if (isAbsolute(path)) {
		return URI.file(path);
	}
	const folder = accessor.get(IWorkspaceContextService).getWorkspace().folders[0];
	return folder ? URI.joinPath(folder.uri, path) : URI.file(path);
}

function resolveTarget(accessor: ServicesAccessor, path: string | undefined) {
	const notebookUri = path ? resolvePathToUri(accessor, path) : undefined;
	return resolveNotebookInstance(
		accessor.get(IPositronNotebookService),
		accessor.get(IEditorService),
		accessor.get(IRuntimeSessionService),
		notebookUri?.toString(),
	);
}

const NO_NOTEBOOK_ERROR = 'No matching Positron notebook is open. Pass a path to an open notebook, or omit it to target the active one.';

interface GetCellsArgs extends TargetedArgs {
	cellIndices?: number[];
	includeOutputs?: boolean;
}

export async function getNotebookCells(accessor: ServicesAccessor, args: GetCellsArgs = {}): Promise<object> {
	const instance = resolveTarget(accessor, args.path);
	if (!instance) {
		return { ok: false, error: NO_NOTEBOOK_ERROR };
	}

	const allCells = instance.cells.get();
	const cells = args.cellIndices ? allCells.filter(cell => args.cellIndices!.includes(cell.index)) : allCells;
	const logService = accessor.get(ILogService);

	const cellDTOs: Array<INotebookCellDTO & { outputs?: object[] }> = [];
	for (const cell of cells) {
		const dto = mapCellToDTO(cell);
		if (!args.includeOutputs) {
			cellDTOs.push(dto);
			continue;
		}
		const outputs = await collectCellOutputDTOs(cell, logService, { textOnly: true });
		cellDTOs.push({ ...dto, outputs });
	}

	return { ok: true, uri: instance.uri.toString(), cellCount: allCells.length, cells: cellDTOs };
}

interface InsertCellArgs extends TargetedArgs {
	cellType: 'code' | 'markdown';
	index?: number;
	content: string;
	run?: boolean;
}

export async function insertNotebookCell(accessor: ServicesAccessor, args: InsertCellArgs): Promise<object> {
	if (!args?.cellType || args.content === undefined) {
		return { ok: false, error: 'cellType and content are required.' };
	}
	const instance = resolveTarget(accessor, args.path);
	if (!instance) {
		return { ok: false, error: NO_NOTEBOOK_ERROR };
	}
	const logService = accessor.get(ILogService);

	const type = args.cellType === 'code' ? NotebookCellType.Code : NotebookCellType.Markdown;
	const index = args.index ?? instance.cells.get().length;
	const insertedIndex = await addNotebookCell(instance, type, index, args.content);

	if (!args.run || args.cellType !== 'code') {
		return { ok: true, index: insertedIndex };
	}

	const ranCells = await runNotebookCells(instance, [insertedIndex]);
	if (ranCells.length === 0) {
		return { ok: true, index: insertedIndex, ran: false };
	}
	const outputs = await collectCellOutputDTOs(ranCells[0], logService, { textOnly: false });
	return { ok: true, index: insertedIndex, ran: true, outputs };
}

interface UpdateCellArgs extends TargetedArgs {
	cellIndex: number;
	content: string;
}

export async function updateNotebookCell(accessor: ServicesAccessor, args: UpdateCellArgs): Promise<object> {
	if (args?.cellIndex === undefined || args.content === undefined) {
		return { ok: false, error: 'cellIndex and content are required.' };
	}
	const instance = resolveTarget(accessor, args.path);
	if (!instance) {
		return { ok: false, error: NO_NOTEBOOK_ERROR };
	}

	return updateNotebookCellContent(instance, args.cellIndex, args.content);
}

interface CellIndicesArgs extends TargetedArgs {
	cellIndices: number[];
}

export async function deleteNotebookCellsCommand(accessor: ServicesAccessor, args: CellIndicesArgs): Promise<object> {
	if (!args?.cellIndices?.length) {
		return { ok: false, error: 'cellIndices must be a non-empty array.' };
	}
	const instance = resolveTarget(accessor, args.path);
	if (!instance) {
		return { ok: false, error: NO_NOTEBOOK_ERROR };
	}

	return deleteNotebookCells(instance, args.cellIndices);
}

export async function runNotebookCellsCommand(accessor: ServicesAccessor, args: CellIndicesArgs): Promise<object> {
	if (!args?.cellIndices?.length) {
		return { ok: false, error: 'cellIndices must be a non-empty array.' };
	}
	const instance = resolveTarget(accessor, args.path);
	if (!instance) {
		return { ok: false, error: NO_NOTEBOOK_ERROR };
	}
	const logService = accessor.get(ILogService);

	const ranCells = await runNotebookCells(instance, args.cellIndices);
	if (ranCells.length === 0) {
		return { ok: false, error: `No cells found with indices: ${args.cellIndices.join(', ')}` };
	}

	const results = [];
	for (const cell of ranCells) {
		results.push({ index: cell.index, outputs: await collectCellOutputDTOs(cell, logService, { textOnly: false }) });
	}
	return { ok: true, results };
}

export const NOTEBOOK_CREATE_COMMAND_ID = 'positronNotebook.create';
export const NOTEBOOK_GET_CELLS_COMMAND_ID = 'positronNotebook.getCells';
export const NOTEBOOK_INSERT_CELL_COMMAND_ID = 'positronNotebook.insertCell';
export const NOTEBOOK_UPDATE_CELL_CONTENT_COMMAND_ID = 'positronNotebook.updateCellContent';
export const NOTEBOOK_DELETE_CELLS_COMMAND_ID = 'positronNotebook.deleteCells';
export const NOTEBOOK_RUN_CELLS_COMMAND_ID = 'positronNotebook.runCells';

const TARGET_PATH_DESCRIPTION = 'The path of the notebook to target (as passed to positronNotebook.create, or any .ipynb path open in a Positron notebook editor). Omitted, targets the active notebook editor, falling back to an open-but-not-focused one when nothing is active.';

CommandsRegistry.registerCommand({
	id: NOTEBOOK_CREATE_COMMAND_ID,
	handler: createNotebook,
	metadata: {
		description: localize(
			'positron.notebook.create.description',
			"Create a new Jupyter notebook (.ipynb file) with the given kernel language and open it in the Positron notebook editor. The notebook starts empty -- use positronNotebook.insertCell to add cells."
		),
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Where to create the notebook and which kernel language it should use.',
			schema: {
				type: 'object',
				required: ['path', 'language'],
				properties: {
					path: { type: 'string', description: 'The path of the notebook file to create, relative to the workspace root. Must end in .ipynb.' },
					language: { type: 'string', enum: ['python', 'r'], description: 'The kernel language for the notebook.' },
				},
			},
		}],
		returns: 'On success: ok: true, path, and uri. On failure: ok: false and error, e.g. the file already exists, no workspace folder is open, or the file was created but did not open in the Positron notebook editor.',
	},
});

CommandsRegistry.registerCommand({
	id: NOTEBOOK_GET_CELLS_COMMAND_ID,
	handler: getNotebookCells,
	metadata: {
		description: localize(
			'positron.notebook.getCells.description',
			"Read the cells of a Jupyter notebook open in the Positron notebook editor: each cell's index, type, content, and execution status."
		),
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Which notebook to read, which cells, and whether to include their outputs.',
			isOptional: true,
			schema: {
				type: 'object',
				required: [],
				properties: {
					path: { type: 'string', description: TARGET_PATH_DESCRIPTION },
					cellIndices: { type: 'array', items: { type: 'number' }, description: 'The 0-based indices of the cells to read. Omitted, reads every cell.' },
					includeOutputs: { type: 'boolean', description: 'Include each code cell\'s text outputs (not images -- use positronNotebook.runCells to get images from a cell). Defaults to false.' },
				},
			},
		}],
		returns: 'On success: ok: true, uri, cellCount, and cells (each with id, index, type, content, hasOutput, selectionStatus, and for code cells executionStatus/executionOrder/lastRunSuccess/lastExecutionDuration/lastRunEndTime, plus outputs when includeOutputs was set). On failure: ok: false and error, when no matching notebook is open.',
	},
});

CommandsRegistry.registerCommand({
	id: NOTEBOOK_INSERT_CELL_COMMAND_ID,
	handler: insertNotebookCell,
	metadata: {
		description: localize(
			'positron.notebook.insertCell.description',
			"Insert a new cell into a Jupyter notebook open in the Positron notebook editor, optionally running it immediately if it's a code cell."
		),
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'The cell to insert, where, and whether to run it.',
			schema: {
				type: 'object',
				required: ['cellType', 'content'],
				properties: {
					path: { type: 'string', description: TARGET_PATH_DESCRIPTION },
					cellType: { type: 'string', enum: ['code', 'markdown'], description: 'The type of cell to insert.' },
					index: { type: 'number', description: '0-based position to insert at. Omitted, appends at the end.' },
					content: { type: 'string', description: 'The cell\'s content.' },
					run: { type: 'boolean', description: 'If true and cellType is code, run the cell immediately and return its outputs.' },
				},
			},
		}],
		returns: 'On success: ok: true and index. When run was set on a code cell, also ran: true and outputs (see positronNotebook.runCells for the outputs shape); ran: false if the index turned out invalid. On failure: ok: false and error, when no matching notebook is open.',
	},
});

CommandsRegistry.registerCommand({
	id: NOTEBOOK_UPDATE_CELL_CONTENT_COMMAND_ID,
	handler: updateNotebookCell,
	metadata: {
		description: localize(
			'positron.notebook.updateCellContent.description',
			"Replace the content of a cell in a Jupyter notebook open in the Positron notebook editor, preserving its type and other properties."
		),
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Which cell to update and its new content.',
			schema: {
				type: 'object',
				required: ['cellIndex', 'content'],
				properties: {
					path: { type: 'string', description: TARGET_PATH_DESCRIPTION },
					cellIndex: { type: 'number', description: 'The 0-based index of the cell to update.' },
					content: { type: 'string', description: 'The cell\'s new content.' },
				},
			},
		}],
		returns: 'ok: true on success. On failure: ok: false and error, e.g. no matching notebook is open or cellIndex is out of range.',
	},
});

CommandsRegistry.registerCommand({
	id: NOTEBOOK_DELETE_CELLS_COMMAND_ID,
	handler: deleteNotebookCellsCommand,
	metadata: {
		description: localize(
			'positron.notebook.deleteCells.description',
			"Delete one or more cells from a Jupyter notebook open in the Positron notebook editor."
		),
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Which cells to delete.',
			schema: {
				type: 'object',
				required: ['cellIndices'],
				properties: {
					path: { type: 'string', description: TARGET_PATH_DESCRIPTION },
					cellIndices: { type: 'array', items: { type: 'number' }, description: 'The 0-based indices of the cells to delete.' },
				},
			},
		}],
		returns: 'ok: true on success. On failure: ok: false and error, e.g. no matching notebook is open or a cellIndex is out of range.',
	},
});

CommandsRegistry.registerCommand({
	id: NOTEBOOK_RUN_CELLS_COMMAND_ID,
	handler: runNotebookCellsCommand,
	metadata: {
		description: localize(
			'positron.notebook.runCells.description',
			"Run one or more cells in a Jupyter notebook open in the Positron notebook editor and return their outputs."
		),
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Which cells to run.',
			schema: {
				type: 'object',
				required: ['cellIndices'],
				properties: {
					path: { type: 'string', description: TARGET_PATH_DESCRIPTION },
					cellIndices: { type: 'array', items: { type: 'number' }, description: 'The 0-based indices of the cells to run.' },
				},
			},
		}],
		returns: 'On success: ok: true and results, one entry per cell run: index and outputs (each with mimeType and data -- text as-is, images and rasterized SVGs base64-encoded). On failure: ok: false and error, e.g. no matching notebook is open or none of cellIndices was valid.',
	},
});
