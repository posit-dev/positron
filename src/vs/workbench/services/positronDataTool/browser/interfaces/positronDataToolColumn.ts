/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataToolComm';

/**
 * IPositronDataToolColumn interface.
 */
export interface IPositronDataToolColumn {
	/**
	 * Gets the identifier.
	 */
	readonly identifier: string;

	/**
	 * Gets the column schema.
	 */
	readonly columnSchema: ColumnSchema;

	/**
	 * Gets or sets the column width.
	 */
	columnWidth: number;

	/**
	 * The onDidChangeColumnWidth event.
	 */
	readonly onDidChangeColumnWidth: Event<number>;
}
