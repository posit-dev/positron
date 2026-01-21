/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Positron notebook assistant DTO cell type.
 * Shared between contrib and api layers.
 * Note: This is distinct from VS Code's internal cell kind/type concepts.
 */
export enum NotebookCellType {
	/** A code cell */
	Code = 'code',

	/** A markdown cell */
	Markdown = 'markdown',
}

/**
 * Data transfer object for notebook cell information.
 * This mirrors notebooks.NotebookCell from the positron extension API.
 */
export interface INotebookCellDTO {
	/** Unique identifier for the cell */
	id: string;

	/** Index of the cell in the notebook (0-based) */
	index: number;

	/** Type of cell */
	type: NotebookCellType;

	/** Content of the cell */
	content: string;

	/** Whether the cell has output */
	hasOutput: boolean;

	/** Selection status of the cell ('unselected' | 'selected' | 'active') */
	selectionStatus: string;

	/**
	 * Execution status of the cell ('running' | 'pending' | 'idle')
	 * Only present for code cells
	 */
	executionStatus?: string;

	/**
	 * Execution order number for the last execution
	 * Only present for code cells
	 */
	executionOrder?: number;

	/**
	 * Whether the last execution was successful
	 * Only present for code cells
	 */
	lastRunSuccess?: boolean;

	/**
	 * Duration of the last execution in milliseconds
	 * Only present for code cells
	 */
	lastExecutionDuration?: number;

	/**
	 * Timestamp when the last execution ended
	 * Only present for code cells
	 */
	lastRunEndTime?: number;

	/**
	 * For markdown cells only: whether the editor is shown (true) or preview is shown (false).
	 * This property is undefined for code cells.
	 */
	editorShown?: boolean;
}

/**
 * Data transfer object for notebook context information.
 * Used to pass notebook state to extensions (e.g., the AI assistant).
 */
export interface INotebookContextDTO {
	uri: string;
	kernelId?: string;
	kernelLanguage?: string;
	cellCount: number;
	selectedCells: INotebookCellDTO[];
	allCells?: INotebookCellDTO[];
}
