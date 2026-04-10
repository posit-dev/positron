/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { IDataConnectionInstance } from './positronDataConnectionsInstance.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDataConnectionDriver, IDataConnectionDriverManager } from './positronDataConnectionsDriver.js';

// DI token used to inject IPositronDataConnectionsService throughout the workbench.
export const IPositronDataConnectionsService = createDecorator<IPositronDataConnectionsService>('positronDataConnectionsService');

/**
 * Service that manages data connection drivers and active connection instances.
 * Drivers are registered by extensions via the ext host RPC pipeline; the UI
 * consumes this service to list drivers, connect, and browse schema trees.
 */
export interface IPositronDataConnectionsService extends IDisposable {
	// Required by the DI system to make this interface structurally unique.
	readonly _serviceBrand: undefined;

	// Manages registered data connection drivers (register, remove, list, change events).
	readonly driverManager: IDataConnectionDriverManager;

	/**
	 * Adds or replaces a connection instance and fires a change event.
	 * @param connection The connection instance to add.
	 */
	addConnection(connection: IDataConnectionInstance): void;

	/**
	 * Gets all active connection instances.
	 * @returns A shallow copy of the connections array.
	 */
	getConnections(): IDataConnectionInstance[];

	/**
	 * Gets a single connection instance by id.
	 * @param id The connection instance id.
	 * @returns The matching instance, or undefined if not found.
	 */
	getConnection(id: string): IDataConnectionInstance | undefined;

	/**
	 * Removes a connection, releases its ext host handle, and fires a change event.
	 * @param id The connection instance id to remove.
	 */
	removeConnection(id: string): void;

	// Fires when drivers are registered or removed.
	onDidChangeDrivers: Event<IDataConnectionDriver[]>;

	// Fires when connections are added or removed.
	onDidChangeConnections: Event<IDataConnectionInstance[]>;
}
