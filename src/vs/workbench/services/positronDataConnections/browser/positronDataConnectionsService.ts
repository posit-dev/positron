/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { DataConnectionDriverManager } from './positronDataConnectionsDriverManager.js';
import { IDataConnectionInstance } from '../common/interfaces/positronDataConnectionsInstance.js';
import { IPositronDataConnectionsService } from '../common/interfaces/positronDataConnectionsService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IDataConnectionDriverManager, IDataConnectionProfile } from '../common/interfaces/positronDataConnectionsDriver.js';

// Storage key prefix for persisted data connection profiles. Each data connection profile gets
// its own key (`{prefix}{profileId}`) so updates rewrite only the changed profile, not the whole
// list.
const PROFILE_STORAGE_KEY_PREFIX = 'positron.dataConnections.profile.';

// Builds the storage key for a given data connection profile id.
const profileStorageKey = (profileId: string) =>
	`${PROFILE_STORAGE_KEY_PREFIX}${profileId}`;

// Builds the secret storage key for a given data connection secret profile/parameter pair.
const secretKey = (profileId: string, parameterId: string) =>
	`positron.dataConnections.secret.${profileId}.${parameterId}`;

// Persisted form of a data connection profile, with secrets split out to secret storage and the
// list of secret parameter ids for lookup and cleanup purposes. This is the shape stored in
// IStorageService; the in-memory IDataConnectionProfile shape never contains secret values.
interface IPersistedDataConnectionProfile {
	profile: IDataConnectionProfile;
	secretParameterIds: string[];
}

/**
 * Service that manages data connection drivers and active data connection instances. Drivers are
 * registered by extensions via the ext host RPC pipeline; the UI consumes this service to list
 * drivers, connect, browse schema trees, and so on.
 */
export class PositronDataConnectionsService extends Disposable implements IPositronDataConnectionsService {
	//#region Private Properties

	// Data connection profiles.
	private readonly _profiles: IDataConnectionProfile[] = [];

	// Data connection instances.
	private readonly _instances: IDataConnectionInstance[] = [];

	// Fires when data connection profiles change.
	private readonly _onDidChangeProfilesEmitter = this._register(new Emitter<IDataConnectionProfile[]>());

	// Fires when data connection instances change.
	private readonly _onDidChangeInstancesEmitter = this._register(new Emitter<IDataConnectionInstance[]>());

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _logService The log service.
	 * @param _storageService The storage service (profile metadata).
	 * @param _secretStorageService The secret storage service (secret parameter values).
	 */
	constructor(
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
	) {
		// Call the base class constructor.
		super();

		// Create the data connection driver manager.
		this.driverManager = this._register(new DataConnectionDriverManager());

		// Load data connection profiles from storage. Secret values stay in secret storage and are
		// fetched on demand by getProfileWithSecrets.
		this._loadProfiles();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataConnectionsService Implementation

	// Required by the DI system to make this interface structurally unique.
	declare readonly _serviceBrand: undefined;

	// Manages registered data connection drivers (register, remove, list, change events).
	readonly driverManager: IDataConnectionDriverManager;

	// Fires when data connection profiles change.
	readonly onDidChangeProfiles: Event<IDataConnectionProfile[]> = this._onDidChangeProfilesEmitter.event;

	// Fires when data connection instances change.
	readonly onDidChangeInstances: Event<IDataConnectionInstance[]> = this._onDidChangeInstancesEmitter.event;

	/**
	 * Adds or updates a data connection profile.
	 * @param profile The data connection profile to add or update.
	 */
	addUpdateProfile(profile: IDataConnectionProfile): void {
		// Sanitize the data connection profile by splitting out secret parameter values into
		// secret storage.
		const sanitizedProfile = this._splitAndPersistSecrets(profile);

		// Replace or add the sanitized data connection profile in memory.
		const index = this._profiles.findIndex(_ => _.id === profile.id);
		if (index >= 0) {
			this._profiles[index] = sanitizedProfile.profile;
		} else {
			this._profiles.push(sanitizedProfile.profile);
		}

		// Persist the sanitized data connection profile under its own storage key.
		this._storageService.store(
			profileStorageKey(sanitizedProfile.profile.id),
			JSON.stringify(sanitizedProfile),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);

		// Log the addition or update.
		this._logService.trace(`[DataConnections] Added or updated profile: ${sanitizedProfile.profile.id}`);

		// Raise the onDidChangeProfiles event.
		this._onDidChangeProfilesEmitter.fire([...this._profiles]);
	}

	/**
	 * Gets all saved data connection profiles.
	 * @returns The data connection profiles array.
	 */
	getProfiles(): readonly IDataConnectionProfile[] {
		return [...this._profiles];
	}

	/**
	 * Gets a data connection profile by id. The returned profile's parameterValues never contains
	 * secret parameter values; use {@link getProfileWithSecrets} when those values are required.
	 * @param id The data connection profile id.
	 * @returns The matching data connection profile, or undefined if not found.
	 */
	getProfile(id: string): IDataConnectionProfile | undefined {
		return this._profiles.find(p => p.id === id);
	}

	/**
	 * Gets a data connection profile by id with its secret parameter values pulled from secret
	 * storage. Callers should use it for an immediate operation and drop the reference right
	 * afterward, not retain it.
	 * @param id The data connection profile id.
	 * @returns The matching data connection profile, or undefined if not found.
	 */
	async getProfileWithSecrets(id: string): Promise<IDataConnectionProfile | undefined> {
		// Look up the data connection profile by id. If not found, return undefined.
		const profile = this._profiles.find(_ => _.id === id);
		if (!profile) {
			return undefined;
		}

		// The persisted data connection profile tells us which parameter ids are secrets for this
		// profile.
		const persistedProfile = this._readPersistedProfile(id);
		const secretParameterIds = persistedProfile?.secretParameterIds ?? [];

		// Build a fresh parameterValues object so we don't mutate the stored profile.
		const parameterValues: typeof profile.parameterValues = { ...profile.parameterValues };
		for (const secretParameterId of secretParameterIds) {
			try {
				const secretValue = await this._secretStorageService.get(secretKey(id, secretParameterId));
				if (secretValue !== undefined) {
					parameterValues[secretParameterId] = secretValue;
				}
			} catch (err) {
				this._logService.error(`[DataConnections] Failed to read secret for ${id}/${secretParameterId}: ${err}`);
			}
		}

		// Return a new profile object that includes the secret parameter values.
		return { ...profile, parameterValues };
	}

	/**
	 * Removes a data connection profile.
	 * @param id The data connection profile id to remove.
	 */
	removeProfile(id: string): void {
		// Find the index of the data connection profile by ID.
		const index = this._profiles.findIndex(_ => _.id === id);
		if (index < 0) {
			return;
		}

		// Remove the data connection profile.
		this._profiles.splice(index, 1);

		// Drop persisted profile metadata and any associated secrets.
		this._removePersistedProfile(id);

		// Log the removal.
		this._logService.trace(`[DataConnections] Removed data connection profile: ${id}`);

		// Raise the onDidChangeProfiles event.
		this._onDidChangeProfilesEmitter.fire([...this._profiles]);
	}

	/**
	 * Adds or updates a data connection instance.
	 * @param instance The data connection instance to add or update.
	 */
	addUpdateInstance(instance: IDataConnectionInstance): void {
		// Add or update the connection instance.
		const index = this._instances.findIndex(_ => _.id === instance.id);
		if (index >= 0) {
			this._instances[index] = instance;
		} else {
			this._instances.push(instance);
		}

		// Log the addition or update.
		this._logService.trace(`[DataConnections] Added or updated connection instance: ${instance.id}`);

		// Raise the onDidChangeInstances event.
		this._onDidChangeInstancesEmitter.fire([...this._instances]);
	}

	/**
	 * Gets all data connection instances.
	 * @returns The data connection instances array.
	 */
	getInstances(): IDataConnectionInstance[] {
		return [...this._instances];
	}

	/**
	 * Gets a data connection instance by id.
	 * @param id The data connection instance id.
	 * @returns The matching instance, or undefined if not found.
	 */
	getInstance(id: string): IDataConnectionInstance | undefined {
		return this._instances.find(c => c.id === id);
	}

	/**
	 * Removes a data connection instance.
	 * @param id The data connection instance id to remove.
	 */
	removeInstance(id: string): void {
		// Find the index of the data connection instance by ID.
		const index = this._instances.findIndex(c => c.id === id);

		// If the data connection instance was found, release its ext host handle and remove it.
		if (index >= 0) {
			// Get the data connection instance.
			const connectionInstance = this._instances[index];

			// Release its ext host handle.
			connectionInstance.connectionHandle.release();

			// Remove the data connection instance.
			this._instances.splice(index, 1);

			// Log the removal.
			this._logService.trace(`[DataConnections] Removed connection instance: ${id}`);

			// Raise the onDidChangeInstances event.
			this._onDidChangeInstancesEmitter.fire([...this._instances]);
		}
	}

	//#endregion IPositronDataConnectionsService Implementation

	//#region Persistence

	/**
	 * Reads persisted data connection profiles from storage into memory. Secret parameter values
	 * stay in secret storage and are not loaded here; getProfileWithSecrets fetches them on demand.
	 */
	private _loadProfiles(): void {
		// Find every storage key for a persisted data connection profile by scanning for the
		// prefix. A bad JSON parse on one entry is logged and skipped; sibling entries still load.
		const allKeys = this._storageService.keys(StorageScope.PROFILE, StorageTarget.USER);
		const profileKeys = allKeys.filter(key => key.startsWith(PROFILE_STORAGE_KEY_PREFIX));

		// Seed the in-memory data connection profiles. Secret parameter ids and secret values
		// stay in storage; we look them up on demand.
		for (const profileKey of profileKeys) {
			// Get the raw data connection profile value.
			const rawProfileValue = this._storageService.get(profileKey, StorageScope.PROFILE);
			if (!rawProfileValue) {
				continue;
			}

			// Parse the raw profile value and add the data connection profile to the in-memory list.
			try {
				const persistedDataConnectionProfile = JSON.parse(rawProfileValue) as IPersistedDataConnectionProfile;
				this._profiles.push(persistedDataConnectionProfile.profile);
			} catch (error) {
				// Log and skip any unparsable raw profile values so one bad entry doesn't block the whole list.
				this._logService.error(`[DataConnections] Failed to parse persisted profile at ${profileKey}: ${error}`);
			}
		}
	}

	/**
	 * Reads the persisted form of a single data connection profile from storage, or returns
	 * undefined if not found or unparseable. Used to look up the secret parameter id list at the points
	 * where we need it (save / remove / read with secrets).
	 */
	private _readPersistedProfile(id: string): IPersistedDataConnectionProfile | undefined {
		// Get the raw data connection profile value. If not found, return undefined.
		const rawProfileValue = this._storageService.get(profileStorageKey(id), StorageScope.PROFILE);
		if (!rawProfileValue) {
			return undefined;
		}

		// Parse the raw data connection profile value and return the persisted data connection profile.
		try {
			return JSON.parse(rawProfileValue) as IPersistedDataConnectionProfile;
		} catch (error) {
			// Log and return undefined if the raw data connection profile value is unparseable.
			this._logService.error(`[DataConnections] Failed to parse persisted profile at ${profileStorageKey(id)}: ${error}`);
			return undefined;
		}
	}

	/**
	 * Splits the incoming profile's parameterValues into public values (returned as part of the
	 * sanitized profile) and secret values (written to secret storage).
	 *
	 * Empty secret values are treated as "no change" so the edit dialog can show an asterisk
	 * placeholder without the user being forced to retype the secret each save.
	 */
	private _splitAndPersistSecrets(profile: IDataConnectionProfile): IPersistedDataConnectionProfile {
		// Read the previously-persisted data connection profile so we can compute orphan secrets.
		const previouslyPersistedProfile = this._readPersistedProfile(profile.id);

		// Identify the current secret parameter ids from the driver.
		const driver = this.driverManager.getDriver(profile.driverMetadata.id);
		const secretParamIdSet = new Set(
			driver?.metadata.parameters
				.filter(_ => (_.type === 'password' || _.type === 'string') && _.secret === true)
				.map(_ => _.id) ?? []
		);

		// Split the profile's parameter values into public values and secret writes.
		const publicParameterValues: typeof profile.parameterValues = {};
		const secretParameterIds: string[] = [];
		for (const [key, value] of Object.entries(profile.parameterValues)) {
			if (secretParamIdSet.has(key)) {
				secretParameterIds.push(key);
				if (typeof value === 'string' && value.length > 0) {
					this._secretStorageService.set(secretKey(profile.id, key), value).catch(err => {
						this._logService.error(`[DataConnections] Failed to write secret for ${profile.id}/${key}: ${err}`);
					});
				}
			} else {
				publicParameterValues[key] = value;
			}
		}

		// Drop any orphaned secrets.
		const previousSecretParameterIds = previouslyPersistedProfile?.secretParameterIds ?? [];
		const stillPresentSecretParameterIds = new Set(secretParameterIds);
		for (const previousSecretParameterId of previousSecretParameterIds) {
			if (!stillPresentSecretParameterIds.has(previousSecretParameterId)) {
				this._secretStorageService.delete(secretKey(profile.id, previousSecretParameterId)).catch(err => {
					this._logService.error(`[DataConnections] Failed to delete secret for ${profile.id}/${previousSecretParameterId}: ${err}`);
				});
			}
		}

		// Return the sanitized data connection profile and the list of secret parameter ids.
		return {
			profile: { ...profile, parameterValues: publicParameterValues },
			secretParameterIds,
		};
	}

	/**
	 * Removes a persisted data connection profile from storage and deletes its associated secrets.
	 */
	private _removePersistedProfile(id: string): void {
		// Obtain the list of secret parameter ids for the data connection profile.
		const secretParameterIds = this._readPersistedProfile(id)?.secretParameterIds ?? [];

		// Remove the data connection profile.
		this._storageService.remove(profileStorageKey(id), StorageScope.PROFILE);

		// Remove the secret parameters for the data connection profile.
		for (const secretParamId of secretParameterIds) {
			this._secretStorageService.delete(secretKey(id, secretParamId)).catch(err => {
				this._logService.error(`[DataConnections] Failed to delete secret for ${id}/${secretParamId}: ${err}`);
			});
		}
	}

	//#endregion Persistence
}

// Register as a lazily instantiated singleton with the DI system.
registerSingleton(
	IPositronDataConnectionsService,
	PositronDataConnectionsService,
	InstantiationType.Delayed
);
