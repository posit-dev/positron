/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { MainPositronContext, MainThreadNotebookFeaturesShape, INotebookContextDTO, INotebookCellDTO } from '../../common/positron/extHost.positron.protocol.js';
import { NotebookCellType } from '../../common/positron/extHostTypes.positron.js';
import { IPositronNotebookService } from '../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell, CellSelectionStatus, IPositronNotebookCodeCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../../contrib/positronNotebook/browser/notebookUtils.js';
import { CellSelectionType, getSelectedCells } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { URI } from '../../../../base/common/uri.js';
import { CellKind, CellEditType } from '../../../contrib/notebook/common/notebookCommon.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

/**
 * Maximum number of cells in a notebook to include all cells in the context.
 * Notebooks with more cells will not include the allCells field to avoid
 * consuming too much context space.
 */
const MAX_CELLS_FOR_ALL_CELLS_CONTEXT = 20;

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

		// Only convert all cells to DTOs if notebook is small enough to avoid unnecessary computation
		let allCells: INotebookCellDTO[] | undefined = undefined;
		if (cells.length < MAX_CELLS_FOR_ALL_CELLS_CONTEXT) {
			allCells = cells.map(cell => this.mapCellToDTO(cell));
		}

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
	 * Gets a specific cell from a notebook by its ID.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell to retrieve.
	 * @returns The cell DTO, or undefined if not found.
	 */
	async $getCell(notebookUri: string, cellId: string): Promise<INotebookCellDTO | undefined> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cell = cells.find(c => c.uri.toString() === cellId);

		if (!cell) {
			return undefined;
		}

		return this.mapCellToDTO(cell);
	}

	/**
	 * Runs the specified cells in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIds Array of cell IDs (cell URIs) to run.
	 */
	async $runCells(notebookUri: string, cellIds: string[]): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellsToRun = cells.filter(cell => cellIds.includes(cell.uri.toString()));

		if (cellsToRun.length === 0) {
			throw new Error(`No cells found with IDs: ${cellIds.join(', ')}`);
		}

		if (cellsToRun.length === 1) {
			// Select the cell
			const cell = cellsToRun[0];
			cell.select(CellSelectionType.Normal);
		}

		return instance.runCells(cellsToRun);
	}

	/**
	 * Adds a new cell to a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param type The type of cell to add.
	 * @param index The index where the cell should be inserted.
	 * @param content The initial content for the cell.
	 * @returns The ID (URI) of the newly created cell.
	 */
	async $addCell(notebookUri: string, type: NotebookCellType, index: number, content: string): Promise<string> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cellKind = type === NotebookCellType.Code ? CellKind.Code : CellKind.Markup;

		// Add cell and enter edit mode
		instance.addCell(cellKind, index, true);

		// Get the newly added cell
		const cells = instance.cells.get();
		const newCell = cells[index];

		if (!newCell) {
			throw new Error('Failed to add cell');
		}

		// Update content if provided
		if (content) {
			await this.$updateCellContent(notebookUri, newCell.uri.toString(), content);
		}

		return newCell.uri.toString();
	}

	/**
	 * Deletes a cell from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell to delete.
	 */
	async $deleteCell(notebookUri: string, cellId: string): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cell = cells.find(c => c.uri.toString() === cellId);

		if (!cell) {
			throw new Error(`Cell not found: ${cellId}`);
		}

		return instance.deleteCell(cell);
	}

	/**
	 * Updates the content of a cell in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell to update.
	 * @param content The new content for the cell.
	 */
	async $updateCellContent(notebookUri: string, cellId: string, content: string): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cell = cells.find(c => c.uri.toString() === cellId);

		if (!cell) {
			throw new Error(`Cell not found: ${cellId}`);
		}

		// Get the cell's model to access its properties
		const cellModel = cell.model;
		const cellIndex = cell.index;

		// Use the notebook text model's applyEdits to replace the cell content
		// This preserves all other cell properties (language, outputs, metadata, etc.)
		const textModel = instance.textModel;
		if (!textModel) {
			throw new Error(`No text model for notebook: ${notebookUri}`);
		}

		const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

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
	}

	/**
	 * Gets the outputs from a code cell.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell.
	 * @returns Array of output strings, one per output item.
	 */
	async $getCellOutputs(notebookUri: string, cellId: string): Promise<string[]> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cell = cells.find(c => c.uri.toString() === cellId);

		if (!cell) {
			throw new Error(`Cell not found: ${cellId}`);
		}

		// Only code cells have outputs
		if (!cell.isCodeCell()) {
			return [];
		}

		// Get outputs from the observable
		const outputs = cell.outputs.get();

		// Convert outputs to strings
		const outputStrings: string[] = [];
		for (const output of outputs) {
			for (const item of output.outputs) {
				// Handle different MIME types
				if (item.mime === 'text/plain') {
					outputStrings.push(item.data.toString());
				} else if (item.mime === 'application/vnd.code.notebook.stdout') {
					outputStrings.push(item.data.toString());
				} else if (item.mime === 'application/vnd.code.notebook.stderr') {
					outputStrings.push(`[stderr] ${item.data.toString()}`);
				} else {
					outputStrings.push(`[${item.mime}] <binary data>`);
				}
			}
		}

		return outputStrings;
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

