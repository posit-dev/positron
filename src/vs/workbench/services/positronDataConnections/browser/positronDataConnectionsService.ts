/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { DataConnectionDriverManager } from './positronDataConnectionsDriverManager.js';
import { IDataConnectionInstance } from '../common/interfaces/positronDataConnectionsInstance.js';
import { IPositronDataConnectionsService } from '../common/interfaces/positronDataConnectionsService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IDataConnectionDriver, IDataConnectionDriverManager } from '../common/interfaces/positronDataConnectionsDriver.js';

/**
 * Service that manages data connection drivers and active connection instances.
 * Drivers are registered by extensions via the ext host RPC pipeline; the UI
 * consumes this service to list drivers, connect, and browse schema trees.
 */
export class PositronDataConnectionsService extends Disposable implements IPositronDataConnectionsService {
	// Required by the DI system to make this interface structurally unique.
	declare readonly _serviceBrand: undefined;

	// The driver manager, which manages registered data connection drivers (register, remove, list, change events).
	readonly driverManager: IDataConnectionDriverManager;

	// Active connection instances, displayed in the UI.
	private readonly _connections: IDataConnectionInstance[] = [];

	// Fires when connections are added or removed.
	private readonly _onDidChangeConnectionsEmitter = this._register(new Emitter<IDataConnectionInstance[]>());

	// Public event consumers subscribe to for connection changes.
	readonly onDidChangeConnections: Event<IDataConnectionInstance[]> = this._onDidChangeConnectionsEmitter.event;

	/**
	 * Delegate onDidChangeDrivers to the driver manager's onDidChangeDrivers event.
	 */
	get onDidChangeDrivers(): Event<IDataConnectionDriver[]> {
		return this.driverManager.onDidChangeDrivers;
	}

	/**
	 * Constructor.
	 * @param _logService The log service.
	 */
	constructor(@ILogService private readonly _logService: ILogService) {
		// Call the base class constructor.
		super();

		// Create the driver manager.
		this.driverManager = this._register(new DataConnectionDriverManager());
	}

	/**
	 * Adds or replaces a connection instance and fires a change event.
	 * @param connection The connection instance to add.
	 */
	addConnection(connection: IDataConnectionInstance): void {
		// Replace or add the connection instance.
		const index = this._connections.findIndex(c => c.id === connection.id);
		if (index >= 0) {
			this._connections[index] = connection;
		} else {
			this._connections.push(connection);
		}

		// Log the addition.
		this._logService.trace(`[DataConnections] Added connection: ${connection.id}`);

		// Raise the onDidChangeConnections event.
		this._onDidChangeConnectionsEmitter.fire([...this._connections]);
	}

	/**
	 * Gets all active connection instances.
	 * @returns A shallow copy of the connections array.
	 */
	getConnections(): IDataConnectionInstance[] {
		return [...this._connections];
	}

	/**
	 * Gets a single connection instance by id.
	 * @param id The connection instance id.
	 * @returns The matching instance, or undefined if not found.
	 */
	getConnection(id: string): IDataConnectionInstance | undefined {
		return this._connections.find(c => c.id === id);
	}

	/**
	 * Removes a connection, releases its ext host handle, and fires a change event.
	 * @param id The connection instance id to remove.
	 */
	removeConnection(id: string): void {
		// Find the index of the connection by ID.
		const index = this._connections.findIndex(c => c.id === id);

		// If the connection was found, release its
		if (index >= 0) {
			// get the connection.
			const connection = this._connections[index];

			// Rreleases its ext host handle.
			connection.connectionHandle.release();

			// Remove the connection instance.
			this._connections.splice(index, 1);

			// Log the removal.
			this._logService.trace(`[DataConnections] Removed connection: ${id}`);

			// Raise the onDidChangeConnections event.
			this._onDidChangeConnectionsEmitter.fire([...this._connections]);
		}
	}
}

// Register as a lazily instantiated singleton with the DI system.
registerSingleton(
	IPositronDataConnectionsService,
	PositronDataConnectionsService,
	InstantiationType.Delayed
);
