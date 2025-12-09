/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICellDto2 } from '../../notebook/common/notebookCommon.js';

export const IPositronNotebookClipboardService = createDecorator<IPositronNotebookClipboardService>('positronNotebookClipboardService');

/**
 * Shared clipboard service for Positron notebooks.
 * This service enables copying and pasting cells between different notebook instances
 * within the same Positron window.
 */
export interface IPositronNotebookClipboardService {
	readonly _serviceBrand: undefined;

	/**
	 * Stores cells in the shared clipboard.
	 * @param cells The cells to store in the clipboard
	 */
	setCells(cells: ICellDto2[]): void;

	/**
	 * Retrieves cells from the shared clipboard.
	 * @returns The cells currently stored in the clipboard, or empty array if none
	 */
	getCells(): ICellDto2[];

	/**
	 * Checks if there are cells available in the shared clipboard.
	 * @returns True if cells are available, false otherwise
	 */
	hasCells(): boolean;

	/**
	 * Clears the shared clipboard.
	 */
	clear(): void;
}

/**
 * The shared clipboard service for Positron notebooks maintains
 * a single shared clipboard across all notebook instances.
 */
export class PositronNotebookClipboardService extends Disposable implements IPositronNotebookClipboardService {
	_serviceBrand: undefined;

	/**
	 * Shared clipboard storage for cell data.
	 */
	private _clipboardCells: ICellDto2[] = [];

	constructor() {
		super();
	}

	public override dispose(): void {
		this._clipboardCells = [];
		super.dispose();
	}

	public setCells(cells: ICellDto2[]): void {
		this._clipboardCells = cells;
	}

	public getCells(): ICellDto2[] {
		return this._clipboardCells;
	}

	public hasCells(): boolean {
		return this._clipboardCells.length > 0;
	}

	public clear(): void {
		this._clipboardCells = [];
	}
}

registerSingleton(IPositronNotebookClipboardService, PositronNotebookClipboardService, InstantiationType.Delayed);
