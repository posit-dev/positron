/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataFragment, DataModel } from './DataModel';
import { ResolverLookup } from './DataPanel';

export class DataFetcher {
	/**
	* The timer used to throttle plot rendering requests.
	*/
	//private _requestDebounceTimer?: NodeJS.Timeout;

	constructor(
		private readonly totalRows: number,
		private readonly dataModel: DataModel,
		private requestQueue: number[],
		private requestResolvers: ResolverLookup,
		private readonly vscode: any
	) {
	}

	public async fetchNextDataFragment(pageParam: number, fetchSize: number): Promise<DataFragment> {
		// Fetches a single page of data from the data model.
		const startRow = pageParam * fetchSize;
		// Overwrite fetchSize so that we never request rows past the end of the dataset
		fetchSize = Math.min(fetchSize, this.totalRows - startRow);

		// Request more rows from the server if we don't have them in the cache
		if (startRow > 0 && !this.dataModel.renderedRows.includes(startRow)) {
			// Don't send duplicate requests
			if (!this.requestQueue.includes(startRow)) {
				this.sendRequest(startRow, fetchSize);
			}

			const promisedFragment = new Promise<DataFragment>((resolve, reject) => {
				// This promise will be resolved in the message event handler
				this.requestResolvers[startRow] = { resolve, reject };
			});
			return promisedFragment;
		} else {
			// No need to wait for a response, return the fragment immediately
			return this.dataModel.loadDataFragment(startRow, fetchSize);
		}
	}

	private sendRequest(startRow: number, fetchSize: number): void {
		this.vscode.postMessage({
			msg_type: 'request_rows',
			start_row: startRow,
			fetch_size: fetchSize
		});
		// Add the outstanding request to the front of the queue
		this.requestQueue.unshift(startRow);
	}

}

