/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { IDataConnectionInstance } from './positronDataConnectionsInstance.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDataConnectionDriverManager, IDataConnectionProfile } from './positronDataConnectionsDriver.js';

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

	// Fires when connection instances are added or removed.
	onDidChangeConnectionInstances: Event<IDataConnectionInstance[]>;

	// Fires when connection profiles are added or removed.
	onDidChangeConnectionProfiles: Event<IDataConnectionProfile[]>;

	/**
	 * Adds or replaces a connection profile and fires a change event.
	 * @param connectionProfile The connection profile to add.
	 */
	addReplaceConnectionProfile(connectionProfile: IDataConnectionProfile): void;

	/**
	 * Gets all saved connection profiles.
	 * @returns A shallow copy of the connection profiles array.
	 */
	getConnectionProfiles(): IDataConnectionProfile[];

	/**
	 * Gets a single connection profile by id.
	 * @param id The connection profile id.
	 * @returns The matching profile, or undefined if not found.
	 */
	getConnectionProfile(id: string): IDataConnectionProfile | undefined;

	/**
	 * Removes a connection profile and fires a change event.
	 * @param id The connection profile id to remove.
	 */
	removeConnectionProfile(id: string): void;

	/**
	 * Adds or replaces a connection instance and fires a change event.
	 * @param connectionInstance The connection instance to add.
	 */
	addConnectionInstance(connectionInstance: IDataConnectionInstance): void;

	/**
	 * Gets all active connection instances.
	 * @returns A shallow copy of the connection instances array.
	 */
	getConnectionInstances(): IDataConnectionInstance[];

	/**
	 * Gets a single connection instance by id.
	 * @param id The connection instance id.
	 * @returns The matching instance, or undefined if not found.
	 */
	getConnectionInstance(id: string): IDataConnectionInstance | undefined;

	/**
	 * Removes a connection instance, releases its ext host handle, and fires a change event.
	 * @param id The connection instance id to remove.
	 */
	removeConnectionInstance(id: string): void;
}
