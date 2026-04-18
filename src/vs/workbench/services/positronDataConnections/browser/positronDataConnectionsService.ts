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
import { IDataConnectionDriverManager, IDataConnectionProfile } from '../common/interfaces/positronDataConnectionsDriver.js';

/**
 * Service that manages data connection drivers and active connection instances.
 * Drivers are registered by extensions via the ext host RPC pipeline; the UI
 * consumes this service to list drivers, connect, and browse schema trees.
 */
export class PositronDataConnectionsService extends Disposable implements IPositronDataConnectionsService {
	//#region Public Properties

	// Required by the DI system to make this interface structurally unique.
	declare readonly _serviceBrand: undefined;

	// The driver manager, which manages registered data connection drivers (register, remove, list, change events).
	readonly driverManager: IDataConnectionDriverManager;

	//#endregion Public Properties

	//#region Private Properties

	// Saved connection profiles.
	private readonly _connectionProfiles: IDataConnectionProfile[] = [];

	// Active connection instances.
	private readonly _connectionInstances: IDataConnectionInstance[] = [];

	// Fires when connection profiles are added or removed.
	private readonly _onDidChangeConnectionProfilesEmitter = this._register(new Emitter<IDataConnectionProfile[]>());

	// Fires when connection instances are added or removed.
	private readonly _onDidChangeConnectionInstancesEmitter = this._register(new Emitter<IDataConnectionInstance[]>());

	//#endregion Private Properties

	//#region Public Events

	//#endregion Public Events

	//#region Constructor & Dispose

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

	//#endregion Constructor & Dispose

	//#region IPositronDataConnectionsService Implementation

	// Public event consumers subscribe to for connection profile changes.
	readonly onDidChangeConnectionProfiles: Event<IDataConnectionProfile[]> = this._onDidChangeConnectionProfilesEmitter.event;

	// Public event consumers subscribe to for connection instance changes.
	readonly onDidChangeConnectionInstances: Event<IDataConnectionInstance[]> = this._onDidChangeConnectionInstancesEmitter.event;

	/**
	 * Adds or replaces a connection profile and fires a change event.
	 * @param connectionProfile The connection profile to add.
	 */
	addReplaceConnectionProfile(connectionProfile: IDataConnectionProfile): void {
		// Replace or add the connection profile.
		const index = this._connectionProfiles.findIndex(_ => _.id === connectionProfile.id);
		if (index >= 0) {
			this._connectionProfiles[index] = connectionProfile;
		} else {
			this._connectionProfiles.push(connectionProfile);
		}

		// Log the addition.
		this._logService.trace(`[DataConnections] Added connection profile: ${connectionProfile.id}`);

		// Raise the onDidChangeConnectionProfiles event.
		this._onDidChangeConnectionProfilesEmitter.fire([...this._connectionProfiles]);
	}

	/**
	 * Gets all saved connection profiles.
	 * @returns A shallow copy of the connection profiles array.
	 */
	getConnectionProfiles(): IDataConnectionProfile[] {
		return [...this._connectionProfiles];
	}

	/**
	 * Gets a single connection profile by id.
	 * @param id The connection profile id.
	 * @returns The matching profile, or undefined if not found.
	 */
	getConnectionProfile(id: string): IDataConnectionProfile | undefined {
		return this._connectionProfiles.find(p => p.id === id);
	}

	/**
	 * Removes a connection profile and fires a change event.
	 * @param id The connection profile id to remove.
	 */
	removeConnectionProfile(id: string): void {
		// Find the index of the connection profile by ID.
		const index = this._connectionProfiles.findIndex(p => p.id === id);

		// If the connection profile was found, remove it.
		if (index >= 0) {
			// Remove the connection profile.
			this._connectionProfiles.splice(index, 1);

			// Log the removal.
			this._logService.trace(`[DataConnections] Removed connection profile: ${id}`);

			// Raise the onDidChangeConnectionProfiles event.
			this._onDidChangeConnectionProfilesEmitter.fire([...this._connectionProfiles]);
		}
	}

	/**
	 * Adds or replaces a connection instance and fires a change event.
	 * @param connectionInstance The connection instance to add.
	 */
	addConnectionInstance(connectionInstance: IDataConnectionInstance): void {
		// Replace or add the connection instance.
		const index = this._connectionInstances.findIndex(c => c.id === connectionInstance.id);
		if (index >= 0) {
			this._connectionInstances[index] = connectionInstance;
		} else {
			this._connectionInstances.push(connectionInstance);
		}

		// Log the addition.
		this._logService.trace(`[DataConnections] Added connection instance: ${connectionInstance.id}`);

		// Raise the onDidChangeConnectionInstances event.
		this._onDidChangeConnectionInstancesEmitter.fire([...this._connectionInstances]);
	}

	/**
	 * Gets all active connection instances.
	 * @returns A shallow copy of the connection instances array.
	 */
	getConnectionInstances(): IDataConnectionInstance[] {
		return [...this._connectionInstances];
	}

	/**
	 * Gets a single connection instance by id.
	 * @param id The connection instance id.
	 * @returns The matching instance, or undefined if not found.
	 */
	getConnectionInstance(id: string): IDataConnectionInstance | undefined {
		return this._connectionInstances.find(c => c.id === id);
	}

	/**
	 * Removes a connection instance, releases its ext host handle, and fires a change event.
	 * @param id The connection instance id to remove.
	 */
	removeConnectionInstance(id: string): void {
		// Find the index of the connection instance by ID.
		const index = this._connectionInstances.findIndex(c => c.id === id);

		// If the connection instance was found, release its ext host handle and remove it.
		if (index >= 0) {
			// Get the connection instance.
			const connectionInstance = this._connectionInstances[index];

			// Release its ext host handle.
			connectionInstance.connectionHandle.release();

			// Remove the connection instance.
			this._connectionInstances.splice(index, 1);

			// Log the removal.
			this._logService.trace(`[DataConnections] Removed connection instance: ${id}`);

			// Raise the onDidChangeConnectionInstances event.
			this._onDidChangeConnectionInstancesEmitter.fire([...this._connectionInstances]);
		}
	}

	//#endregion IPositronDataConnectionsService Implementation
}

// Register as a lazily instantiated singleton with the DI system.
registerSingleton(
	IPositronDataConnectionsService,
	PositronDataConnectionsService,
	InstantiationType.Delayed
);
