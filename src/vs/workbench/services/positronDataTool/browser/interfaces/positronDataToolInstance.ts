/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IPositronDataToolColumn } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolColumn';
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
	 * Gets or sets the columns.
	 */
	readonly columns: IPositronDataToolColumn[];

	/**
	 * Gets or sets the columns scroll offset.
	 */
	columnsScrollOffset: number;

	/**
	 * Gets or sets the rows scroll offset.
	 */
	rowsScrollOffset: number;

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

	/**
	 * The onDidChangeRowsScrollOffset event.
	 */
	readonly onDidChangeRowsScrollOffset: Event<number>;
}
