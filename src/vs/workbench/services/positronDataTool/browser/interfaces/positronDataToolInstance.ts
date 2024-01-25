/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDataGridInstance } from 'vs/base/browser/ui/dataGrid/interfaces/dataGridInstance';
import { PositronDataToolLayout } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';

/**
 * IPositronDataToolInstance interface.
 */
export interface IPositronDataToolInstance {
	/**
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets or sets the layout.
	 */
	layout: PositronDataToolLayout;

	/**
	 * Gets or sets the columns width percent.
	 */
	columnsWidthPercent: number;

	/**
	 * Gets or sets the columns scroll offset.
	 */
	columnsScrollOffset: number;

	/**
	 * Gets the data grid instance.
	 */
	readonly positronDataGridInstance: IDataGridInstance;

	/**
	 * The onDidChangeLayout event.
	 */
	readonly onDidChangeLayout: Event<PositronDataToolLayout>;

	/**
	 * The onDidChangeColumnsWidthPercent event.
	 */
	readonly onDidChangeColumnsWidthPercent: Event<number>;

	/**
	 * The onDidChangeColumnsScrollOffset event.
	 */
	readonly onDidChangeColumnsScrollOffset: Event<number>;
}
