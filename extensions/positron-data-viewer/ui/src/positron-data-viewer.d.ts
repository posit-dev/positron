/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * This module defines the interfaces used by the Positron data viewer, both for
 * the data format itself and for the messages sent between the data viewer and
 * the host.
 *
 * Because there isn't a reasonable mechanism for sharing type definitions
 * between extensions, this file is duplicated in several places in the
 * repository. See e.g. `git-base.d.ts` in the Git extension for another example
 * of this pattern.
 *
 * When updating it:
 * - ensure that all copies are updated; and
 * - add only type definitions, not implementation code.
 */

/**
 * A single column of data. The viewer deals with data in columnar format since
 * that best matches the way data is stored in most data sources.
 */
export interface DataColumn {
	/**
	 * The name of the column.
	 */
	name: string;

	/**
	 * The type of data contained in the column.
	 */
	type: string;

	/**
	 * The data in the column; the exact type of the data depends on the type
	 * of the column.
	 */
	data: Array<any>;
}

/**
 * A data set that can be displayed in the data viewer.
 */
export interface DataSet {
	/**
	 * The unique ID of the data set.
	 */
	id: string;

	/**
	 * The title of the data set, for display in the data viewer tab.
	 * Typically, it's the name of the data source, such as the variable name in
	 * the environment or the name of a file.
	 */
	title: string;

	/**
	 * The columns of data.
	 */
	columns: Array<DataColumn>;

	/**
	 * The number of rows in the data set.
	 */
	rowCount: number;
}

export interface DataViewerMessage {
	/**
	 * The type of the message.
	 */
	msg_type: DataViewerMessageType;
	start_row: number;
	fetch_size: number;
}

/**
 * A message sent from the data viewer to the host indicating that
 * the data viewer is requesting data.
 */
export interface DataViewerMessageRowRequest extends DataViewerMessage { }

/**
 * A message sent from the host to the data viewer containing a batch of rows
 * to be rendered in the data viewer.
 */
export interface DataViewerMessageRowResponse extends DataViewerMessage {
	/**
	 * The data set.
	 */
	data: DataSet;
}

/**
 * The possible message types for messages sent between the data viewer
 * window/frame and the host extension.
 *
 * These messages are sent using `postMessage` and are serialized to JSON;
 * the verbs are from the perspective of the iframe.
 *
 * - `ready`: The data viewer is ready to receive data.
 * - `initial_data`: Initial data to be displayed in the data viewer.
 * - `request_rows`: The data viewer is requesting additional data from the host.
 * - `receive_rows`: The data viewer is receiving additional data from the host.
 */
export type DataViewerMessageType = 'ready' | 'initial_data' | 'request_rows' | 'receive_rows';

