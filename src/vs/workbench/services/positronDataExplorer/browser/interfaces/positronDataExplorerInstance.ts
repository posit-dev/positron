/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { TableDataDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableDataDataGridInstance';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';
import { PositronDataExplorerLayout } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';

/**
 * IPositronDataExplorerInstance interface.
 */
export interface IPositronDataExplorerInstance {
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
}
