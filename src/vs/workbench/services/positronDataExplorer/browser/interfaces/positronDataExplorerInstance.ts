/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { TableDataDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableDataDataGridInstance';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * IPositronDataExplorerInstance interface.
 */
export interface IPositronDataExplorerInstance extends IDisposable {
	/**
	 * Gets the data explorer client instance.
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
	 * Gets or sets the columns width percent.
	 */
	columnsWidthPercent: number;

	/**
	 * Gets the TableSchemaDataGridInstance.
	 */
	readonly tableSchemaDataGridInstance: TableSummaryDataGridInstance;

	/**
	 * Gets the TableDataDataGridInstance.
	 */
	readonly tableDataDataGridInstance: TableDataDataGridInstance;

	/**
	 * The onDidClose event.
	 */
	readonly onDidClose: Event<void>;

	/**
	 * The onDidChangeLayout event.
	 */
	readonly onDidChangeLayout: Event<PositronDataExplorerLayout>;

	/**
	 * The onDidChangeColumnsWidthPercent event.
	 */
	readonly onDidChangeColumnsWidthPercent: Event<number>;

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
	 * Copies the selection or cursor cell to the clipboard.
	 */
	copyToClipboard(): Promise<void>;

	/**
	 * Copies the table data to the clipboard.
	 */
	copyTableDataToClipboard(): Promise<void>;
}
