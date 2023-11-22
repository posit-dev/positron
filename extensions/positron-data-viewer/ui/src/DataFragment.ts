/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataColumn, DataViewerMessage, DataViewerMessageRowResponse } from './positron-data-viewer';
import { ResolverLookup } from './fetchData';

/**
 * A fragment of data, arranged by column.
 */
export class DataFragment {
	/**
	 * Create a new DataFragment.
	 *
	 * @param columns The rows of data, arranged by column.
	 * @param rowStart The row index of the first row in the fragment.
	 */

	// The maximum number of requests in the queue to handle. Requests further down the queue will be ignored.
	// Keep in sync with queue size on the language backends
	private static readonly queueSize = 3;
	public readonly rowEnd: number;

	constructor(
		public readonly columns: DataColumn[],
		public readonly rowStart: number,
		size: number
	) {
		this.rowEnd = rowStart + size - 1;
	}

	public static handleDataMessage(event: any, requestQueue: number[], requestResolvers: ResolverLookup) {
		const message = event.data as DataViewerMessage;
		const queuePosition = requestQueue.indexOf(message.start_row);

		const isValidRequest = (
			// Ignore non-data messages
			(message.msg_type === 'receive_rows' || message.msg_type === 'canceled_request') &&
			// Ignore requests that have already been fulfilled (i.e. are not in the queue anymore)
			requestQueue.length &&
			queuePosition !== -1
		);

		if (!isValidRequest) {
			return;
		}

		// If this request has been canceled by the backend or is not within the n most recently made requests,
		// reject the promise and remove it from the queue
		if (message.msg_type === 'canceled_request' || queuePosition >= this.queueSize) {
			requestQueue.splice(queuePosition, 1);
			requestResolvers[message.start_row].reject(
				`Request for rows ${message.start_row} to ${message.start_row + message.fetch_size - 1} canceled`
			);
			return;
		}

		const dataMessage = message as DataViewerMessageRowResponse;
		const incrementalData = new DataFragment(dataMessage.data.columns, dataMessage.start_row, dataMessage.fetch_size);

		// Resolve the promise and remove this request from the queue
		requestQueue.splice(queuePosition, 1);
		requestResolvers[message.start_row].resolve(incrementalData);
	}

	public transpose() {
		return this.columns[0].data.map(
			// Transpose the data for the current page
			(_, rowIdx) => this.columns.map(col => col.data[rowIdx])
		);
	}
}
