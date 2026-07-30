/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Serializable transport types for the Data Explorer RPC channel between core (browser) and a
 * backend-providing extension (ext host). These are the lean envelope shapes that cross the wire;
 * the typed payloads remain an internal contract that core and each extension mirror separately
 * (core via positronDataExplorerComm.ts, each extension via its own interfaces.ts).
 */

/** A single Data Explorer RPC request: a backend-request method, a dataset identifier, and params. */
export interface IDataExplorerRpcDto {
	/** The backend-request method name (a `DataExplorerBackendRequest` value). */
	method: string;
	/** The dataset identifier the request targets. Omitted only for dataset-less bootstrap calls. */
	uri?: string;
	/** Method-specific parameters. */
	params: object;
}

/** The response to a Data Explorer RPC: a result payload or an error message. */
export interface IDataExplorerResponseDto {
	result?: unknown;
	error_message?: string;
}

/** A frontend UI event pushed from a backend (e.g. async column profiles), routed by dataset id. */
export interface IDataExplorerUiEventDto {
	/** The dataset identifier the event targets. */
	uri: string;
	/** The frontend-event method name (a `DataExplorerFrontendEvent` value). */
	method: string;
	/** Event-specific parameters. */
	params: object;
}

/**
 * The transport a core Data Explorer backend uses to reach the providing extension. Implemented by
 * `MainThreadDataExplorer`, which forwards each request over the typed ext-host channel.
 */
export interface IDataExplorerRpcTransport {
	/**
	 * Sends a Data Explorer RPC to the extension that registered `providerId`.
	 * @param providerId The provider the dataset belongs to (e.g. 'positron-duckdb').
	 * @param rpc The request envelope.
	 */
	handleRpc(providerId: string, rpc: IDataExplorerRpcDto): Promise<IDataExplorerResponseDto>;

	/**
	 * Notifies the providing extension that a dataset's Data Explorer has closed, so it can release
	 * per-dataset resources. Fire-and-forget; does not activate a dormant provider.
	 * @param providerId The provider the dataset belongs to (e.g. 'positron-duckdb').
	 * @param datasetId The dataset identifier (the RPC `uri`) that was closed.
	 */
	disposeBackend(providerId: string, datasetId: string): void;
}
