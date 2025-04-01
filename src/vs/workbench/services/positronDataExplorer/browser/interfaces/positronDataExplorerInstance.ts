/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { TableDataDataGridInstance } from '../tableDataDataGridInstance.js';
import { DataExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { TableSummaryDataGridInstance } from '../tableSummaryDataGridInstance.js';
import { PositronDataExplorerLayout } from './positronDataExplorerService.js';

/**
 * IPositronDataExplorerInstance interface.
 */
export interface IPositronDataExplorerInstance extends IDisposable {
	/**
	 * Gets the language name.
	 */
	readonly languageName: string;

	/**
	 * Gets the data explorer client instance.
	 */
	readonly dataExplorerClientInstance: DataExplorerClientInstance;

	/**
	 * Gets or sets the layout.
	 */
	layout: PositronDataExplorerLayout;

	/**
	 * Gets or sets a value which indicates whether the summary is collapsed.
	 */
	isSummaryCollapsed: boolean;

	/**
	 * Gets or sets the summary width in pixels.
	 */
	summaryWidth: number;

	/**
	 * Gets the TableSchemaDataGridInstance.
	 */
	readonly tableSchemaDataGridInstance: TableSummaryDataGridInstance;

	/**
	 * Gets the TableDataDataGridInstance.
	 */
	readonly tableDataDataGridInstance: TableDataDataGridInstance;

	/**
	 * Gets a value which indicates whether one or more columns are sorted.
	 */
	readonly isColumnSorting: boolean;

	/**
	 * The onDidClose event.
	 */
	readonly onDidClose: Event<void>;

	/**
	 * The onDidChangeLayout event.
	 */
	readonly onDidChangeLayout: Event<PositronDataExplorerLayout>;

	/**
	 * The onDidChangeSummaryWidth event.
	 */
	readonly onDidChangeSummaryWidth: Event<number>;

	/**
	 * The onDidRequestFocus event.
	 */
	readonly onDidRequestFocus: Event<void>;

	/**
	 * The onDidCollapseSummary event.
	 */
	readonly onDidCollapseSummary: Event<void>;

	/**
	 * The onDidExpandSummary event.
	 */
	readonly onDidExpandSummary: Event<void>;

	/**
	 * The onDidChangeColumnSorting event.
	 */
	readonly onDidChangeColumnSorting: Event<boolean>;

	/**
	 * Requests focus for the instance.
	 */
	requestFocus(): void;

	/**
	 * Collapses the summary.
	 */
	collapseSummary(): void;

	/**
	 * Expands the summary.
	 */
	expandSummary(): void;

	/**
	 * Clears column sorting.
	 * @returns A Promise<void> that resolves when column sorting has been cleared.
	 */
	clearColumnSorting(): Promise<void>;

	/**
	 * Copies the selection or cursor cell to the clipboard.
	 */
	copyToClipboard(): Promise<void>;

	/**
	 * Copies the table data to the clipboard.
	 */
	copyTableDataToClipboard(): Promise<void>;
}
