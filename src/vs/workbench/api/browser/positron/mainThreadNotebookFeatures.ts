/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { MainPositronContext, MainThreadNotebookFeaturesShape, INotebookCellOutputDTO } from '../../common/positron/extHost.positron.protocol.js';
import { INotebookCellDTO, INotebookContextDTO, NotebookCellType } from '../../../common/positron/notebookAssistant.js';
import { IPositronNotebookService } from '../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance, NotebookOperationType } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane, getUnsupportedNotebookEditorMessage } from '../../../contrib/positronNotebook/browser/notebookUtils.js';
import { getSelectedCells } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { URI } from '../../../../base/common/uri.js';
import { CellEditType } from '../../../contrib/notebook/common/notebookCommon.js';
import { cellToCellDtoForRestore } from '../../../contrib/positronNotebook/browser/cellClipboardUtils.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY } from '../../../contrib/positronNotebook/common/positronNotebookConfig.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../../contrib/positronNotebook/common/positronNotebookCommon.js';
import { addNotebookCell, collectCellOutputDTOs, deleteNotebookCells, mapCellToDTO, runNotebookCells, updateNotebookCellContent } from '../../../contrib/positronNotebook/browser/notebookAgentOperations.js';

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
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		// No initialization needed
	}

	/**
	 * Gets the context information for the currently active notebook. When no
	 * Positron notebook is the active editor pane, falls back to the open
	 * notebook attached to the foreground session, then to the most recently
	 * active Positron notebook that is still open.
	 * @returns The notebook context DTO, or undefined if no notebook is open.
	 */
	async $getActiveNotebookContext(): Promise<INotebookContextDTO | undefined> {
		// Use existing helper function instead of service method
		let instance = getNotebookInstanceFromActiveEditorPane(this._editorService);
		if (!instance) {
			// A notebook may be open, but in the built-in editor rather than the
			// Positron Notebook Editor that this API operates on. Surface an
			// actionable error telling the user how to switch editors, instead of
			// a bare "no notebook is open" that callers cannot distinguish from
			// having nothing open at all.
			const unsupportedEditorMessage = getUnsupportedNotebookEditorMessage(this._editorService);
			if (unsupportedEditorMessage) {
				throw new Error(unsupportedEditorMessage);
			}
			// A Positron notebook can be open without being the active editor
			// pane (a Data Explorer or plot editor took the pane, focus moved
			// to another tab mid-turn). Fall back to an open notebook so
			// assistant tools can still find it (#14762).
			instance = this._getFallbackNotebookInstance();
			if (!instance) {
				return undefined;
			}
		}

		// Get current state from observables
		const cells = instance.cells.get();
		const kernel = instance.kernel.get();
		const selectionState = instance.selectionStateMachine.state.get();

		// Map selected cells using helper function
		const selectedCells: INotebookCellDTO[] = [];
		const selectedCellsList = getSelectedCells(selectionState);
		for (const cell of selectedCellsList) {
			selectedCells.push(mapCellToDTO(cell));
		}

		// Include all cells - filtering will be done on the extension side
		const allCells = cells.map(cell => mapCellToDTO(cell));

		// Get runtime state from the session service
		const notebookUri = instance.uri;
		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		const runtimeState = session?.getRuntimeState();

		return {
			uri: notebookUri.toString(),
			kernelId: kernel?.id,
			kernelLanguage: kernel?.runtime.languageId,
			cellCount: cells.length,
			selectedCells,
			allCells,
			runtimeState: runtimeState ?? undefined,
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
			cellDTOs.push(mapCellToDTO(cell));
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

		return mapCellToDTO(cells[cellIndex]);
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

		const ranCells = await runNotebookCells(instance, cellIndices);
		if (ranCells.length === 0) {
			throw new Error(`No cells found with indices: ${cellIndices.join(', ')}`);
		}
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

		return addNotebookCell(instance, type, index, content);
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

		const cellToDelete = cells[cellIndex];

		// Capture complete cell data before deletion (outputs omitted for memory)
		const cellData = cellToCellDtoForRestore(cellToDelete);

		// Delete the cell
		instance.deleteCell(cellToDelete);

		// Add sentinel with complete cell data
		instance.addDeletionSentinel(cellIndex, cellData);
	}

	/**
	 * Deletes multiple cells from a notebook.
	 * Creates individual deletion sentinels for each deleted cell.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndices Array of cell indices to delete.
	 */
	async $deleteCells(notebookUri: string, cellIndices: number[]): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const result = await deleteNotebookCells(instance, cellIndices);
		if (!result.ok) {
			throw new Error(result.error);
		}
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

		const result = await updateNotebookCellContent(instance, cellIndex, content);
		if (!result.ok) {
			throw new Error(result.error);
		}
	}

	/**
	 * Gets the outputs from a code cell.
	 *
	 * SVG outputs are rasterized to base64-encoded PNG (falling back to raw
	 * SVG text when rasterization fails) so assistants can attach them as
	 * images (#12096).
	 *
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

		return collectCellOutputDTOs(cells[cellIndex], this._logService, { textOnly: false });
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
		await instance.handleAssistantCellModification(toIndex, 'modify');
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
	 * Scrolls to a cell if it's out of view and auto-follow is enabled.
	 * Respects the `positron.assistant.notebook.autoFollow` setting.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to scroll to.
	 */
	async $scrollToCellIfNeeded(notebookUri: string, cellIndex: number): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			return;
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			return;
		}

		const cell = cells[cellIndex];
		if (!cell) {
			return;
		}

		// Check if cell is visible
		const isVisible = cell.isInViewport();
		if (!isVisible) {
			// Check auto-follow setting
			const autoFollow = this._configurationService.getValue<boolean>(
				POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY
			) ?? true;

			if (autoFollow) {
				await cell.reveal({ reason: 'programmatic' });
			}
		}
	}

	/**
	 * Clears cell outputs in a notebook.
	 * If cellIndices is provided, clears only those cells. Otherwise clears all.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndices Optional array of cell indices to clear.
	 */
	async $clearCellOutputs(notebookUri: string, cellIndices?: number[]): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		if (cellIndices === undefined) {
			// Clear all cell outputs
			instance.clearAllCellOutputs();
		} else {
			if (cellIndices.length === 0) {
				return;
			}

			const cells = instance.cells.get();
			const cellCount = cells.length;

			// De-duplicate and sort ascending
			const uniqueIndices = [...new Set(cellIndices)].sort((a, b) => a - b);

			// Validate all indices
			for (const idx of uniqueIndices) {
				if (!Number.isInteger(idx) || idx < 0 || idx >= cellCount) {
					throw new Error(`Invalid cell index: ${idx}. Must be between 0 and ${cellCount - 1}`);
				}
			}

			instance.clearCellOutputsByIndex(uniqueIndices);
		}
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
	 * Finds an open Positron notebook instance when none is the active editor
	 * pane. Prefers the notebook attached to the foreground session (what the
	 * interpreter picker shows, and what assistant notebook mode is keyed on),
	 * then falls back to the notebook whose editor was most recently active.
	 * @returns The notebook instance, or undefined if no Positron notebook
	 * editor is open.
	 */
	private _getFallbackNotebookInstance(): IPositronNotebookInstance | undefined {
		const foregroundNotebookUri = this._runtimeSessionService.foregroundSession?.metadata.notebookUri;
		if (foregroundNotebookUri) {
			const instances = this._positronNotebookService.listInstances(foregroundNotebookUri);
			if (instances.length > 0) {
				return instances[0];
			}
		}
		for (const { editor } of this._editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			if (editor.typeId !== POSITRON_NOTEBOOK_EDITOR_INPUT_ID || !editor.resource) {
				continue;
			}
			const instances = this._positronNotebookService.listInstances(editor.resource);
			if (instances.length > 0) {
				return instances[0];
			}
		}
		return undefined;
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

