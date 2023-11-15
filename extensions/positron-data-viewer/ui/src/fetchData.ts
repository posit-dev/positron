/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DataFragment } from './DataFragment';


// A dict-like object to store functions used to resolve a Promise with a DataFragment (or reject it).
// Resolve functions are indexed by the request ID (i.e. the start row number)
// and resolved when that request is fulfilled or rejected when it is canceled/superceded.
export type ResolverLookup = {
	[requestId: number]: {
		resolve: (fragment: DataFragment) => void;
		reject: (reason?: any) => void;
	};
};

export class DataFetcher {
	constructor(
		private requestQueue: number[],
		private requestResolvers: ResolverLookup,
		private totalRows: number,
		private vscode: any
	) {

	}

	// Fetches a single page of data from the data model.
	async fetchNextDataFragment(
		pageParam: number,
		fetchSize: number,
	): Promise<DataFragment> {
		const startRow = pageParam * fetchSize;
		// Overwrite fetchSize so that we never request rows past the end of the dataset
		fetchSize = Math.min(fetchSize, this.totalRows - startRow);

		// Don't send duplicate requests
		if (!this.requestQueue.includes(startRow)) {
			this.vscode.postMessage({
				msg_type: 'request_rows',
				start_row: startRow,
				fetch_size: fetchSize
			});
			// Add the outstanding request to the front of the queue
			this.requestQueue.unshift(startRow);
		}

		const promisedFragment = new Promise<DataFragment>((resolve, reject) => {
			// This promise will be resolved in the message event handler
			this.requestResolvers[startRow] = { resolve, reject };
		});
		return promisedFragment;
	}
}
