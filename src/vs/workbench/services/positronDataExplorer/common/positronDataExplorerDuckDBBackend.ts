/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import {
	DataExplorerBackendRequest,
	DatasetImportOptions,
	OpenDatasetResult,
	SetDatasetImportOptionsParams,
	SetDatasetImportOptionsResult,
} from '../../languageRuntime/common/positronDataExplorerComm.js';
import { IDataExplorerRpcTransport } from './dataExplorerRpcTransport.js';
import { PositronDataExplorerExtensionBackend } from './positronDataExplorerExtensionBackend.js';

/** The provider id the positron-duckdb extension registers its RPC handler under. */
export const DUCKDB_DATA_EXPLORER_PROVIDER_ID = 'positron-duckdb';

/**
 * The Data Explorer backend for files opened with the positron-duckdb extension.
 *
 * This is a thin specialization of {@link PositronDataExplorerExtensionBackend}: it bootstraps the
 * dataset with an `open_dataset` call and adds the DuckDB-only `setDatasetImportOptions` (used by
 * the CSV header-row toggle). All generic RPC forwarding lives in the base class.
 */
export class PositronDataExplorerDuckDBBackend extends PositronDataExplorerExtensionBackend {

	constructor(
		transport: IDataExplorerRpcTransport,
		private readonly uri: URI
	) {
		// The wire `uri` is the bare file URI (which the extension parses to import the file); the
		// core-side client id is prefixed so the editor/instance key stays distinct.
		super(transport, DUCKDB_DATA_EXPLORER_PROVIDER_ID, uri.toString(), `duckdb:${uri.toString()}`);
		this.initialSetup = this.openDataset();
	}

	private async openDataset() {
		const result = await this._execRpc<OpenDatasetResult>({
			method: DataExplorerBackendRequest.OpenDataset,
			params: { uri: this.uri.toString() }
		});

		if (result.error_message) {
			return Promise.reject(new Error(result.error_message));
		}
	}

	/**
	 * Set import options for the file-based dataset and reimport it. DuckDB-specific; invoked by the
	 * Data Explorer's file header-row toggle.
	 * @param options The import options to apply.
	 */
	async setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
		return this._execRpc<SetDatasetImportOptionsResult>({
			method: DataExplorerBackendRequest.SetDatasetImportOptions,
			uri: this.uri.toString(),
			params: { options } satisfies SetDatasetImportOptionsParams
		});
	}
}
