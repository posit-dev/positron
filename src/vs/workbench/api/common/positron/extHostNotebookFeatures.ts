/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol.js';
import type * as positron from 'positron';
import { NotebookCellType } from './extHostTypes.positron.js';

/**
 * Extension host implementation of notebook features.
 * Provides a wrapper around the main thread notebook features API for use by extensions.
 */
export class ExtHostNotebookFeatures implements extHostProtocol.ExtHostNotebookFeaturesShape {
	private readonly _proxy: extHostProtocol.MainThreadNotebookFeaturesShape;

	constructor(mainContext: extHostProtocol.IMainPositronContext) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadNotebookFeatures);
	}

	/**
	 * Gets the context information for the currently active notebook.
	 * @returns The notebook context DTO, or undefined if no notebook is active.
	 */
	async getActiveNotebookContext(): Promise<extHostProtocol.INotebookContextDTO | undefined> {
		return this._proxy.$getActiveNotebookContext();
	}

	/**
	 * Gets all cells from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @returns Array of all cells in the notebook.
	 */
	async getCells(notebookUri: string): Promise<positron.notebooks.NotebookCell[]> {
		return this._proxy.$getCells(notebookUri);
	}

	/**
	 * Gets a specific cell from a notebook by its ID.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell to retrieve.
	 * @returns The cell DTO, or undefined if not found.
	 */
	async getCell(notebookUri: string, cellId: string): Promise<positron.notebooks.NotebookCell | undefined> {
		return this._proxy.$getCell(notebookUri, cellId);
	}

	/**
	 * Runs the specified cells in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIds Array of cell IDs (cell URIs) to run.
	 */
	async runCells(notebookUri: string, cellIds: string[]): Promise<void> {
		return this._proxy.$runCells(notebookUri, cellIds);
	}

	/**
	 * Adds a new cell to a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param type The type of cell to add.
	 * @param index The index where the cell should be inserted.
	 * @param content The initial content for the cell.
	 * @returns The ID (URI) of the newly created cell.
	 */
	async addCell(notebookUri: string, type: NotebookCellType, index: number, content: string): Promise<string> {
		return this._proxy.$addCell(notebookUri, type, index, content);
	}

	/**
	 * Deletes a cell from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell to delete.
	 */
	async deleteCell(notebookUri: string, cellId: string): Promise<void> {
		return this._proxy.$deleteCell(notebookUri, cellId);
	}

	/**
	 * Updates the content of a cell in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell to update.
	 * @param content The new content for the cell.
	 */
	async updateCellContent(notebookUri: string, cellId: string, content: string): Promise<void> {
		return this._proxy.$updateCellContent(notebookUri, cellId, content);
	}

	/**
	 * Gets the outputs from a code cell.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellId The ID (URI) of the cell.
	 * @returns Array of output objects with MIME type and data.
	 */
	async getCellOutputs(notebookUri: string, cellId: string): Promise<extHostProtocol.INotebookCellOutputDTO[]> {
		return this._proxy.$getCellOutputs(notebookUri, cellId);
	}
}

