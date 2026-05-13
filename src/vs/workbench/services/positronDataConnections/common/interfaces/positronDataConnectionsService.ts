/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { IDataConnectionInstance } from './dataConnectionInstance.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDataConnectionProfile } from './dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from './dataConnectionsDriverManager.js';

// DI token used to inject IPositronDataConnectionsService throughout the workbench.
export const IPositronDataConnectionsService = createDecorator<IPositronDataConnectionsService>('positronDataConnectionsService');

/**
 * Service that manages data connection drivers and active data connection instances. Drivers are
 * registered by extensions via the ext host RPC pipeline; the UI consumes this service to list
 * drivers, connect, browse schema trees, and so on.
 */
export interface IPositronDataConnectionsService extends IDisposable {
	// Required by the DI system to make this interface structurally unique.
	readonly _serviceBrand: undefined;

	// Manages registered data connection drivers (register, remove, list, change events).
	readonly driverManager: IDataConnectionsDriverManager;

	// Fires when data connection profiles change.
	onDidChangeProfiles: Event<IDataConnectionProfile[]>;

	// Fires when data connection instances change.
	onDidChangeInstances: Event<IDataConnectionInstance[]>;

	/**
	 * Adds or updates a data connection profile.
	 * @param profile The data connection profile to add or update.
	 */
	addUpdateProfile(profile: IDataConnectionProfile): void;

	/**
	 * Gets all saved data connection profiles.
	 * @returns The data connection profiles array.
	 */
	getProfiles(): readonly IDataConnectionProfile[];

	/**
	 * Gets a data connection profile by id. The returned profile's parameterValues never contains
	 * secret parameter values; use {@link getProfileWithSecrets} when those values are required.
	 * @param id The data connection profile id.
	 * @returns The matching data connection profile, or undefined if not found.
	 */
	getProfile(id: string): IDataConnectionProfile | undefined;

	/**
	 * Gets a data connection profile by id with its secret parameter values pulled from secret
	 * storage. Callers should use it for an immediate operation and drop the reference right
	 * afterward, not retain it.
	 * @param id The data connection profile id.
	 * @returns The matching data connection profile, or undefined if not found.
	 */
	getProfileWithSecrets(id: string): Promise<IDataConnectionProfile | undefined>;

	/**
	 * Gets the parameter ids for which a secret value is stored on the given profile, without
	 * loading the values themselves. Used by the edit dialog to render a "saved" placeholder
	 * for secret fields that already have a value, distinguishing them from never-set ones.
	 * @param id The data connection profile id.
	 * @returns The list of parameter ids with stored secrets. Empty if the profile has no
	 * stored secrets (or no longer exists).
	 */
	getProfileSecretIds(id: string): readonly string[];

	/**
	 * Removes a data connection profile.
	 * @param id The data connection profile id to remove.
	 */
	removeProfile(id: string): void;

	/**
	 * Adds or updates a data connection instance.
	 * @param instance The data connection instance to add or update.
	 */
	addUpdateInstance(instance: IDataConnectionInstance): void;

	/**
	 * Gets all data connection instances.
	 * @returns The data connection instances array.
	 */
	getInstances(): IDataConnectionInstance[];

	/**
	 * Gets a data connection instance by id.
	 * @param id The data connection instance id.
	 * @returns The matching instance, or undefined if not found.
	 */
	getInstance(id: string): IDataConnectionInstance | undefined;

	/**
	 * Removes a data connection instance.
	 * @param id The data connection instance id to remove.
	 */
	removeInstance(id: string): void;
}
