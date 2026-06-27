/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IPositronDataExplorerInstance } from './positronDataExplorerInstance.js';
import { IDataExplorerRpcTransport, IDataExplorerUiEventDto } from '../../common/dataExplorerRpcTransport.js';

// Create the decorator for the Positron data explorer service (used in dependency injection).
export const IPositronDataExplorerService = createDecorator<IPositronDataExplorerService>('positronDataExplorerService');

/**
 * PositronDataExplorerLayout enumeration.
 */
export enum PositronDataExplorerLayout {
	SummaryOnLeft = 'SummaryOnLeft',
	SummaryOnRight = 'SummaryOnRight'
}

/**
 * Identifies a dataset served by a backend-providing extension over the typed Data Explorer
 * channel, used when asking Positron to open it.
 */
export interface OpenExtensionBackendPayload {
	/** The provider id the extension registered its RPC handler under (e.g. 'positron-duckdb'). */
	providerId: string;
	/** Stable dataset identifier; used as the RPC `uri`, the client id, and the editor URI. */
	datasetId: string;
	/** Human-readable name shown for the dataset (e.g. the table name). */
	displayName: string;
}

/**
 * IPositronDataExplorerService interface.
 */
export interface IPositronDataExplorerService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets or sets the active Positron data explorer instance.
	 */
	readonly activePositronDataExplorerInstance?: IPositronDataExplorerInstance;

	/**
	 * Placeholder that gets called to "initialize" the PositronDataExplorerService.
	 */
	initialize(): void;

	/**
	 * Gets the instance for the specified identifier.
	 * @param identifier The instance identifier.
	 */
	getInstance(identifier: string): IPositronDataExplorerInstance | undefined;

	/**
	 * Gets the instance for the specified variable.
	 *
	 * @param variableId The variable identifier.
	 */
	getInstanceForVar(variableId: string): IPositronDataExplorerInstance | undefined;

	/**
	 * Associates a variable with an instance.
	 *
	 * @param instanceId The instance identifier.
	 * @param variableId The variable identifier.
	 */
	setInstanceForVar(instanceId: string, variableId: string): void;

	/**
	 * Gets the instance for the specified canonical variable path within a session.
	 *
	 * @param sessionId The runtime session ID.
	 * @param variablePath The encoded variable path.
	 */
	getInstanceForVariablePath(sessionId: string, variablePath: string[]): IPositronDataExplorerInstance | undefined;

	/**
	 * Open a URI in the data explorer using the positron-duckdb extension.
	 * @param uri The URI, usually a file in the workspace.
	 */
	openWithDuckDB(uri: URI): Promise<void>;

	/**
	 * Open a Data Explorer backed by a built-in extension over the typed channel (e.g. a data
	 * connection driver previewing a table), without a backing file.
	 * @param payload The provider id, dataset identifier, and display name.
	 */
	openWithExtensionBackend(payload: OpenExtensionBackendPayload): Promise<void>;

	/**
	 * Registers the transport core backends use to reach backend-providing extensions. Called by
	 * the main-thread Data Explorer channel actor.
	 * @param transport The transport.
	 * @returns A disposable that clears the transport.
	 */
	registerRpcTransport(transport: IDataExplorerRpcTransport): IDisposable;

	/**
	 * Routes a frontend UI event from a backend-providing extension to the matching backend.
	 * @param event The UI event.
	 */
	routeUiEvent(event: IDataExplorerUiEventDto): void;

	/**
	 * Event that fires when a new data explorer instance is registered.
	 */
	readonly onDidRegisterInstance: Event<IPositronDataExplorerInstance>;

	/**
	 * Gets an instance by identifier, waiting for it to be registered if needed.
	 * @param identifier The instance identifier.
	 * @param timeoutMs Maximum time to wait in milliseconds (default: 5000).
	 * @returns A promise that resolves to the instance, or undefined if not found within timeout.
	 */
	getInstanceAsync(identifier: string, timeoutMs?: number): Promise<IPositronDataExplorerInstance | undefined>;
}
