/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { CellEditType, CellKind, ICellDto2 } from '../../notebook/common/notebookCommon.js';
import { INotebookCellDTO, INotebookCellOutputDTO, NotebookCellType } from '../../../common/positron/notebookAssistant.js';
import { IPositronNotebookInstance, NotebookOperationType } from './IPositronNotebookInstance.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { IPositronNotebookCell, IPositronNotebookCodeCell, CellSelectionStatus } from './PositronNotebookCells/IPositronNotebookCell.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';
import { CellSelectionType } from './selectionMachine.js';
import { cellToCellDtoForRestore } from './cellClipboardUtils.js';
import { isImageMimeType, isTextBasedMimeType } from './notebookMimeUtils.js';
import { isSvgMimeType } from '../../../services/positronPlots/common/imageDataUrl.js';
import { rasterizeSvgToPng } from './svgToPng.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../common/positronNotebookCommon.js';

/**
 * Notebook cell and output operations shared by `MainThreadNotebookFeatures`
 * (which serves the `positron.notebooks.*` extension API) and
 * `positronNotebookAgentCommands.ts` (which serves the same operations to the
 * `agentCompatible` command catalog, i.e. MCP and Assistant's generic
 * `positronCommand` tool). Keeping the logic here means neither caller
 * reimplements cell resolution, output encoding, or the follow-mode/undo
 * bookkeeping that goes with editing a live notebook.
 */

/** Map a live cell to the DTO shape shared with extensions and agent commands. */
export function mapCellToDTO(cell: IPositronNotebookCell): INotebookCellDTO {
	const isCodeCell = cell.isCodeCell();
	const isMarkdownCell = cell.isMarkdownCell();
	const cellOutputs = isCodeCell ? cell.outputs.get() : [];

	const rawSelectionStatus = cell.selectionStatus.get();
	const selectionStatus = rawSelectionStatus === CellSelectionStatus.Editing
		? 'active'
		: rawSelectionStatus === CellSelectionStatus.Selected
			? 'selected'
			: 'unselected';

	const baseDTO: INotebookCellDTO = {
		id: cell.uri.toString(),
		index: cell.index,
		type: cell.kind === CellKind.Code ? NotebookCellType.Code : NotebookCellType.Markdown,
		content: cell.getContent(),
		hasOutput: cellOutputs.length > 0,
		selectionStatus
	};

	if (isCodeCell) {
		const codeCell = cell as IPositronNotebookCodeCell;
		baseDTO.executionStatus = codeCell.executionStatus.get();
		baseDTO.executionOrder = codeCell.lastExecutionOrder.get();
		baseDTO.lastRunSuccess = codeCell.lastRunSuccess.get();
		baseDTO.lastExecutionDuration = codeCell.lastExecutionDuration.get();
		baseDTO.lastRunEndTime = codeCell.lastRunEndTime.get();
	}

	if (isMarkdownCell) {
		baseDTO.editorShown = cell.editorShown.get();
	}

	return baseDTO;
}

/**
 * Find an open Positron notebook instance when none is the active editor
 * pane. Prefers the notebook attached to the foreground session, then falls
 * back to the notebook whose editor was most recently active.
 */
function fallbackNotebookInstance(
	positronNotebookService: IPositronNotebookService,
	editorService: IEditorService,
	runtimeSessionService: IRuntimeSessionService,
): IPositronNotebookInstance | undefined {
	const foregroundNotebookUri = runtimeSessionService.foregroundSession?.metadata.notebookUri;
	if (foregroundNotebookUri) {
		const instances = positronNotebookService.listInstances(foregroundNotebookUri);
		if (instances.length > 0) {
			return instances[0];
		}
	}
	for (const { editor } of editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
		if (editor.typeId !== POSITRON_NOTEBOOK_EDITOR_INPUT_ID || !editor.resource) {
			continue;
		}
		const instances = positronNotebookService.listInstances(editor.resource);
		if (instances.length > 0) {
			return instances[0];
		}
	}
	return undefined;
}

/**
 * Resolve the notebook an operation should target: the notebook at
 * `notebookUri` when given, otherwise the active editor's notebook, falling
 * back to an open-but-not-active one (#14762).
 */
export function resolveNotebookInstance(
	positronNotebookService: IPositronNotebookService,
	editorService: IEditorService,
	runtimeSessionService: IRuntimeSessionService,
	notebookUri?: string,
): IPositronNotebookInstance | undefined {
	if (notebookUri) {
		const instances = positronNotebookService.listInstances(URI.parse(notebookUri));
		return instances.length > 0 ? instances[0] : undefined;
	}
	return getNotebookInstanceFromActiveEditorPane(editorService)
		?? fallbackNotebookInstance(positronNotebookService, editorService, runtimeSessionService);
}

/**
 * Collect a code cell's outputs as DTOs. SVG outputs are rasterized to
 * base64-encoded PNG (falling back to raw SVG text when rasterization fails)
 * so agents can attach them as images (#12096).
 *
 * @param textOnly When true, skip image outputs entirely -- used for the
 *  lightweight `includeOutputs` on a read, as opposed to a run, which wants
 *  the full output set.
 */
export async function collectCellOutputDTOs(
	cell: IPositronNotebookCell,
	logService: ILogService,
	options: { textOnly: boolean },
): Promise<INotebookCellOutputDTO[]> {
	if (!cell.isCodeCell()) {
		return [];
	}

	const outputs = cell.outputs.get();
	const outputDTOs: INotebookCellOutputDTO[] = [];

	for (const output of outputs) {
		const hasRasterImageSibling = output.outputs.some(item => isImageMimeType(item.mime));
		for (const item of output.outputs) {
			const mimeType = item.mime;

			if (mimeType === 'application/vnd.code.notebook.stderr') {
				outputDTOs.push({ mimeType, data: `[stderr] ${item.data.toString()}` });
			} else if (isSvgMimeType(mimeType) && !hasRasterImageSibling) {
				if (options.textOnly) {
					continue;
				}
				const svgText = item.data.toString();
				const pngData = await rasterizeSvgToPng(svgText);
				if (pngData !== undefined) {
					outputDTOs.push({ mimeType: 'image/png', data: pngData });
				} else {
					logService.warn('Failed to rasterize SVG notebook output to PNG. Returning raw SVG text.');
					outputDTOs.push({ mimeType, data: svgText });
				}
			} else if (isImageMimeType(mimeType)) {
				if (options.textOnly) {
					continue;
				}
				outputDTOs.push({ mimeType, data: encodeBase64(item.data) });
			} else if (isTextBasedMimeType(mimeType)) {
				outputDTOs.push({ mimeType, data: item.data.toString() });
			} else if (!options.textOnly) {
				logService.warn(`Unknown MIME type "${mimeType}" in notebook cell output. Defaulting to base64 encoding.`);
				outputDTOs.push({ mimeType, data: encodeBase64(item.data) });
			}
		}
	}

	return outputDTOs;
}

/** Run cells and notify follow mode, returning the cells that actually ran. */
export async function runNotebookCells(
	instance: IPositronNotebookInstance,
	cellIndices: readonly number[],
): Promise<IPositronNotebookCell[]> {
	const cells = instance.cells.get();
	const cellsToRun = cellIndices
		.filter(index => index >= 0 && index < cells.length)
		.map(index => cells[index]);

	if (cellsToRun.length === 0) {
		return [];
	}

	// Select the last cell in the range (somewhat arbitrary).
	const lastCell = cellsToRun[cellsToRun.length - 1];
	lastCell.select(CellSelectionType.Normal);

	await instance.runCells(cellsToRun);
	await instance.handleAssistantCellModification(lastCell.index);

	return cellsToRun;
}

/** Insert a cell and notify follow mode. Returns the index it was inserted at. */
export async function addNotebookCell(
	instance: IPositronNotebookInstance,
	type: NotebookCellType,
	index: number,
	content: string,
): Promise<number> {
	const cellKind = type === NotebookCellType.Code ? CellKind.Code : CellKind.Markup;

	// Mark this as an assistant operation to prevent automatic selection/scrolling;
	// follow mode controls reveal behavior based on user preferences.
	instance.setCurrentOperation(NotebookOperationType.AssistantAdd);
	instance.addCell(cellKind, index, false, content);

	await instance.handleAssistantCellModification(index, 'add');

	return index;
}

/** Delete cells, recording undo sentinels, and notify follow mode. */
export async function deleteNotebookCells(
	instance: IPositronNotebookInstance,
	cellIndices: readonly number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
	const cells = instance.cells.get();

	const cellsToDelete: IPositronNotebookCell[] = [];
	const cellDataForSentinels: Array<{ index: number; data: ICellDto2 }> = [];

	for (const cellIndex of cellIndices) {
		if (cellIndex < 0 || cellIndex >= cells.length) {
			return { ok: false, error: `Cell not found at index: ${cellIndex}` };
		}
		const cell = cells[cellIndex];
		cellsToDelete.push(cell);
		cellDataForSentinels.push({ index: cellIndex, data: cellToCellDtoForRestore(cell) });
	}

	// Higher indices first so they don't shift as earlier ones are deleted.
	cellDataForSentinels.sort((a, b) => b.index - a.index);

	instance.deleteCells(cellsToDelete);

	for (const { index, data } of cellDataForSentinels) {
		instance.addDeletionSentinel(index, data);
	}

	const lowestIndex = Math.min(...cellIndices);
	await instance.handleAssistantCellModification(lowestIndex, 'delete');

	return { ok: true };
}

/** Replace a cell's content in place, preserving its other properties, and notify follow mode. */
export async function updateNotebookCellContent(
	instance: IPositronNotebookInstance,
	cellIndex: number,
	content: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const cells = instance.cells.get();
	if (cellIndex < 0 || cellIndex >= cells.length) {
		return { ok: false, error: `Cell not found at index: ${cellIndex}` };
	}

	const cell = cells[cellIndex];
	const cellModel = cell.model;
	const textModel = instance.textModel;
	if (!textModel) {
		return { ok: false, error: `No text model found for notebook: ${instance.uri.toString()}` };
	}

	const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

	instance.setCurrentOperation(NotebookOperationType.AssistantEdit);

	textModel.applyEdits([
		{
			editType: CellEditType.Replace,
			index: cellIndex,
			count: 1,
			cells: [
				{
					source: content,
					language: cellModel.language,
					mime: cellModel.mime,
					cellKind: cellModel.cellKind,
					outputs: cellModel.outputs.map(output => ({
						outputId: output.outputId,
						outputs: output.outputs
					})),
					metadata: cellModel.metadata,
					internalMetadata: cellModel.internalMetadata
				}
			]
		}
	], true, undefined, () => undefined, undefined, computeUndoRedo);

	await instance.handleAssistantCellModification(cellIndex, 'modify');

	return { ok: true };
}
