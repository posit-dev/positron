/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { MainPositronContext, MainThreadNotebookFeaturesShape, INotebookContextDTO, INotebookCellDTO, INotebookCellOutputDTO } from '../../common/positron/extHost.positron.protocol.js';
import { NotebookCellType } from '../../common/positron/extHostTypes.positron.js';
import { IPositronNotebookService } from '../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance, NotebookOperationType } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell, CellSelectionStatus, IPositronNotebookCodeCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../../contrib/positronNotebook/browser/notebookUtils.js';
import { CellSelectionType, getSelectedCells } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { URI } from '../../../../base/common/uri.js';
import { CellKind, CellEditType } from '../../../contrib/notebook/common/notebookCommon.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { isImageMimeType, isTextBasedMimeType } from '../../../contrib/positronNotebook/browser/notebookMimeUtils.js';

/**
 * Main thread implementation of notebook features for extension host communication.
 * Provides methods for interacting with Positron notebooks from extensions.
 */
@extHostNamedCustomer(MainPositronContext.MainThreadNotebookFeatures)
export class MainThreadNotebookFeatures implements MainThreadNotebookFeaturesShape {
	private readonly _disposables = new DisposableStore();

	constructor(
		_extHostContext: IExtHostContext,
		@IEditorService private readonly _editorService: IEditorService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@ILogService private readonly _logService: ILogService,
	) {
		// No initialization needed
	}

	/**
	 * Helper function to map a cell to DTO
	 * @param cell The cell to map
	 * @returns The cell DTO with status information
	 */
	private mapCellToDTO(cell: IPositronNotebookCell): INotebookCellDTO {
		const cellId = cell.uri.toString();
		const isCodeCell = cell.isCodeCell();
		const cellOutputs = isCodeCell ? cell.outputs.get() : [];

		// Map selection status: 'editing' -> 'active', others map directly
		const rawSelectionStatus = cell.selectionStatus.get();
		const selectionStatus = rawSelectionStatus === CellSelectionStatus.Editing
			? 'active'
			: rawSelectionStatus === CellSelectionStatus.Selected
				? 'selected'
				: 'unselected';

		const baseDTO: INotebookCellDTO = {
			id: cellId,
			index: cell.index,
			type: cell.kind === CellKind.Code ? NotebookCellType.Code : NotebookCellType.Markdown,
			content: cell.getContent(),
			hasOutput: cellOutputs.length > 0,
			selectionStatus
		};

		// Add execution-related fields only for code cells
		if (isCodeCell) {
			const codeCell = cell as IPositronNotebookCodeCell;
			baseDTO.executionStatus = codeCell.executionStatus.get();
			baseDTO.executionOrder = codeCell.lastExecutionOrder.get();
			baseDTO.lastRunSuccess = codeCell.lastRunSuccess.get();
			baseDTO.lastExecutionDuration = codeCell.lastExecutionDuration.get();
			baseDTO.lastRunEndTime = codeCell.lastRunEndTime.get();
		}

		return baseDTO;
	}

	/**
	 * Gets the context information for the currently active notebook.
	 * @returns The notebook context DTO, or undefined if no notebook is active.
	 */
	async $getActiveNotebookContext(): Promise<INotebookContextDTO | undefined> {
		// Use existing helper function instead of service method
		const instance = getNotebookInstanceFromActiveEditorPane(this._editorService);
		if (!instance) {
			return undefined;
		}

		// Get current state from observables
		const cells = instance.cells.get();
		const kernel = instance.kernel.get();
		const selectionState = instance.selectionStateMachine.state.get();

		// Map selected cells using helper function
		const selectedCells: INotebookCellDTO[] = [];
		const selectedCellsList = getSelectedCells(selectionState);
		for (const cell of selectedCellsList) {
			selectedCells.push(this.mapCellToDTO(cell));
		}

		// Include all cells - filtering will be done on the extension side
		const allCells = cells.map(cell => this.mapCellToDTO(cell));

		return {
			uri: instance.uri.toString(),
			kernelId: kernel?.id,
			kernelLanguage: kernel?.runtime.languageId,
			cellCount: cells.length,
			selectedCells,
			allCells
		};
	}

	/**
	 * Gets all cells from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @returns Array of all cells in the notebook.
	 */
	async $getCells(notebookUri: string): Promise<INotebookCellDTO[]> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellDTOs: INotebookCellDTO[] = [];

		for (const cell of cells) {
			cellDTOs.push(this.mapCellToDTO(cell));
		}

		return cellDTOs;
	}

	/**
	 * Gets a specific cell from a notebook by its index.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to retrieve.
	 * @returns The cell DTO, or undefined if not found.
	 */
	async $getCell(notebookUri: string, cellIndex: number): Promise<INotebookCellDTO | undefined> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			return undefined;
		}

		return this.mapCellToDTO(cells[cellIndex]);
	}

	/**
	 * Runs the specified cells in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndices Array of cell indices to run.
	 */
	async $runCells(notebookUri: string, cellIndices: number[]): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellsToRun = cellIndices
			.filter(index => index >= 0 && index < cells.length)
			.map(index => cells[index]);

		if (cellsToRun.length === 0) {
			throw new Error(`No cells found with indices: ${cellIndices.join(', ')}`);
		}

		// Select the last cell in the range (somewhat arbitrary)
		const lastCell = cellsToRun[cellsToRun.length - 1];
		lastCell.select(CellSelectionType.Normal);

		await instance.runCells(cellsToRun);

		// Notify about assistant cell modification for follow mode
		// Use the last cell that was actually run (from filtered cellsToRun),
		// not the original cellIndices array which may contain invalid indices
		await instance.handleAssistantCellModification(lastCell.index);
	}

	/**
	 * Adds a new cell to a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param type The type of cell to add.
	 * @param index The index where the cell should be inserted.
	 * @param content The initial content for the cell.
	 * @returns The index of the newly created cell.
	 */
	async $addCell(notebookUri: string, type: NotebookCellType, index: number, content: string): Promise<number> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cellKind = type === NotebookCellType.Code ? CellKind.Code : CellKind.Markup;

		// Mark this as an assistant operation to prevent automatic selection/scrolling.
		// The follow mode will control reveal behavior based on user preferences.
		instance.setCurrentOperation(NotebookOperationType.AssistantAdd);
		instance.addCell(cellKind, index, false, content);

		// Notify about assistant cell modification for follow mode
		await instance.handleAssistantCellModification(index);

		return index;
	}

	/**
	 * Deletes a cell from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to delete.
	 */
	async $deleteCell(notebookUri: string, cellIndex: number): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}

		instance.deleteCell(cells[cellIndex]);
	}

	/**
	 * Updates the content of a cell in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to update.
	 * @param content The new content for the cell.
	 */
	async $updateCellContent(notebookUri: string, cellIndex: number, content: string): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}

		const cell = cells[cellIndex];

		// Get the cell's model to access its properties
		const cellModel = cell.model;

		// Use the notebook text model's applyEdits to replace the cell content
		// This preserves all other cell properties (language, outputs, metadata, etc.)
		const textModel = this._getTextModel(instance, notebookUri);

		const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

		// Mark this as an assistant operation to prevent automatic selection/scrolling.
		// The follow mode will control reveal behavior based on user preferences.
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

		// Notify about assistant cell modification for follow mode
		await instance.handleAssistantCellModification(cellIndex);
	}

	/**
	 * Gets the outputs from a code cell.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell.
	 * @returns Array of output objects with MIME type and data (text or base64-encoded binary).
	 */
	async $getCellOutputs(notebookUri: string, cellIndex: number): Promise<INotebookCellOutputDTO[]> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}

		const cell = cells[cellIndex];

		// Only code cells have outputs
		if (!cell.isCodeCell()) {
			return [];
		}

		// Get outputs from the observable
		const outputs = cell.outputs.get();

		// Convert outputs to structured DTOs
		const outputDTOs: INotebookCellOutputDTO[] = [];
		for (const output of outputs) {
			for (const item of output.outputs) {
				const mimeType = item.mime;

				// Handle stderr outputs with prefix
				if (mimeType === 'application/vnd.code.notebook.stderr') {
					outputDTOs.push({
						mimeType: mimeType,
						data: `[stderr] ${item.data.toString()}`
					});
				}
				// Handle image MIME types - base64 encode
				else if (isImageMimeType(mimeType)) {
					const base64Data = encodeBase64(item.data);
					outputDTOs.push({
						mimeType: mimeType,
						data: base64Data
					});
				}
				// Handle text-based MIME types - convert to string
				else if (isTextBasedMimeType(mimeType)) {
					outputDTOs.push({
						mimeType: mimeType,
						data: item.data.toString()
					});
				}
				// Unknown MIME type - log warning and default to base64 encoding (safer for unknown binary data)
				else {
					this._logService.warn(`Unknown MIME type "${mimeType}" in notebook cell output. Defaulting to base64 encoding.`);
					const base64Data = encodeBase64(item.data);
					outputDTOs.push({
						mimeType: mimeType,
						data: base64Data
					});
				}
			}
		}

		return outputDTOs;
	}

	/**
	 * Moves a cell from one index to another in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param fromIndex The current index of the cell to move.
	 * @param toIndex The target index where the cell should be moved to.
	 */
	async $moveCell(notebookUri: string, fromIndex: number, toIndex: number): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellCount = cells.length;

		// Validate indices
		if (fromIndex < 0 || fromIndex >= cellCount) {
			throw new Error(`Invalid fromIndex: ${fromIndex}. Must be between 0 and ${cellCount - 1}`);
		}
		if (toIndex < 0 || toIndex >= cellCount) {
			throw new Error(`Invalid toIndex: ${toIndex}. Must be between 0 and ${cellCount - 1}`);
		}

		// No-op if moving to same position
		if (fromIndex === toIndex) {
			return;
		}

		const textModel = this._getTextModel(instance, notebookUri);

		const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

		// Mark this as an assistant operation
		instance.setCurrentOperation(NotebookOperationType.AssistantEdit);

		textModel.applyEdits([{
			editType: CellEditType.Move,
			index: fromIndex,
			length: 1,
			newIdx: toIndex
		}], true, undefined, () => undefined, undefined, computeUndoRedo);

		// Notify about assistant cell modification for follow mode
		await instance.handleAssistantCellModification(toIndex);
	}

	/**
	 * Reorders all cells in a notebook according to a new order.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param newOrder Array representing the new order - newOrder[i] is the index of the cell
	 *                 that should be at position i in the reordered notebook.
	 */
	async $reorderCells(notebookUri: string, newOrder: number[]): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellCount = cells.length;

		// Validate the permutation
		if (newOrder.length !== cellCount) {
			throw new Error(`Invalid newOrder length: ${newOrder.length}. Must match cell count: ${cellCount}`);
		}

		// Check that it's a valid permutation (each index 0 to n-1 appears exactly once)
		const seen = new Set<number>();
		for (const index of newOrder) {
			if (!Number.isInteger(index) || index < 0 || index >= cellCount) {
				throw new Error(`Invalid index in newOrder: ${index}. Must be between 0 and ${cellCount - 1}`);
			}
			if (seen.has(index)) {
				throw new Error(`Duplicate index in newOrder: ${index}. Each index must appear exactly once`);
			}
			seen.add(index);
		}

		// Check if this is a no-op (identity permutation)
		let isIdentity = true;
		for (let i = 0; i < cellCount; i++) {
			if (newOrder[i] !== i) {
				isIdentity = false;
				break;
			}
		}
		if (isIdentity) {
			return;
		}

		const textModel = this._getTextModel(instance, notebookUri);

		const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

		// Mark this as an assistant operation
		instance.setCurrentOperation(NotebookOperationType.AssistantEdit);

		// Apply the reordering as a series of move operations
		// We use a cycle-based approach to minimize moves:
		// For each cycle in the permutation, we perform cycle_length - 1 moves
		const currentOrder = [...Array(cellCount).keys()]; // [0, 1, 2, ..., n-1]
		const visited = new Set<number>();

		for (let startPos = 0; startPos < cellCount; startPos++) {
			if (visited.has(startPos) || newOrder[startPos] === currentOrder[startPos]) {
				visited.add(startPos);
				continue;
			}

			// Follow the cycle
			let pos = startPos;
			while (!visited.has(pos)) {
				visited.add(pos);
				const targetCellOriginalIndex = newOrder[pos];
				const currentPosOfTargetCell = currentOrder.indexOf(targetCellOriginalIndex);

				if (currentPosOfTargetCell !== pos) {
					// Move the cell from currentPosOfTargetCell to pos
					textModel.applyEdits([{
						editType: CellEditType.Move,
						index: currentPosOfTargetCell,
						length: 1,
						newIdx: pos
					}], true, undefined, () => undefined, undefined, computeUndoRedo);

					// Update our tracking of current positions
					const movedValue = currentOrder.splice(currentPosOfTargetCell, 1)[0];
					currentOrder.splice(pos, 0, movedValue);
				}

				// Find the next position in the cycle
				const nextPos = newOrder.indexOf(currentOrder[pos], pos + 1);
				if (nextPos === -1 || visited.has(nextPos)) {
					break;
				}
				pos = nextPos;
			}
		}

		// Notify about assistant cell modification for follow mode (use first cell as reference)
		await instance.handleAssistantCellModification(0);
	}

	/**
	 * Helper method to ensure and return a notebook's text model.
	 * Asserts the text model is defined and narrows the type for TypeScript.
	 * @param instance The notebook instance.
	 * @param notebookUri The URI of the notebook (for error messaging).
	 * @returns The notebook's text model.
	 */
	private _getTextModel(instance: IPositronNotebookInstance, notebookUri: string) {
		if (!instance.textModel) {
			throw new Error(`No text model found for notebook: ${notebookUri}`);
		}
		return instance.textModel;
	}

	/**
	 * Helper method to get a notebook instance by URI string.
	 * @param uriString The notebook URI as a string.
	 * @returns The notebook instance, or undefined if not found.
	 */
	private _getInstanceByUri(uriString: string): IPositronNotebookInstance | undefined {
		const uri = URI.parse(uriString);
		const instances = this._positronNotebookService.listInstances(uri);
		return instances.length > 0 ? instances[0] : undefined;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}

