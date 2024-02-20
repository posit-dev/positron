/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { TableDataDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableDataDataGridInstance';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * IPositronDataExplorerInstance interface.
 */
export interface IPositronDataExplorerInstance {
	/**
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets or sets the layout.
	 */
	layout: PositronDataExplorerLayout;

	/**
	 * Gets or sets the columns width percent.
	 */
	columnsWidthPercent: number;

	/**
	 * Gets or sets the columns scroll offset.
	 */
	columnsScrollOffset: number;

	/**
	 * Gets the TableSchemaDataGridInstance.
	 */
	readonly tableSchemaDataGridInstance: TableSummaryDataGridInstance;

	/**
	 * Gets the TableDataDataGridInstance.
	 */
	readonly tableDataDataGridInstance: TableDataDataGridInstance;

	/**
	 * The onDidChangeLayout event.
	 */
	readonly onDidChangeLayout: Event<PositronDataExplorerLayout>;

	/**
	 * The onDidChangeColumnsWidthPercent event.
	 */
	readonly onDidChangeColumnsWidthPercent: Event<number>;

	/**
	 * The onDidChangeColumnsScrollOffset event.
	 */
	readonly onDidChangeColumnsScrollOffset: Event<number>;
}
