/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
}

export interface DataViewerMessage {
	/**
	 * The type of the message.
	 */
	msg_type: DataViewerMessageType;
}

/**
 * A message sent from the data viewer to the host indicating that
 * the data viewer is ready to receive data.
 */
export interface DataViewerMessageReady extends DataViewerMessage { }

/**
 * A message sent from the host to the data viewer containing a data set to be
 * displayed in the viewer.
 */
export interface DataViewerMessageData extends DataViewerMessage {
	/**
	 * The data set.
	 */
	data: Array<DataColumn>;
}

export enum DataViewerMessageType {
	/**
	 * The data viewer is ready to receive data.
	 */
	Ready = 'ready',

	/**
	 * The data viewer has received a data set.
	 */
	Data = 'data',
}

