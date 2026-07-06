/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { DataConnectionsDriverManager } from './dataConnectionsDriverManager.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IDataConnectionInstance } from '../common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../common/interfaces/positronDataConnectionsService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IDataConnectionProfile, resolveDataConnectionMechanism } from '../common/interfaces/dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from '../common/interfaces/dataConnectionsDriverManager.js';

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
	 * @param extensionService The extension service.
	 * @param _logService The log service.
	 * @param _secretStorageService The secret storage service (secret parameter values).
	 * @param _storageService The storage service (profile metadata).
	 */
	constructor(
		@IExtensionService extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		// Call the base class constructor.
		super();

		// Create the data connection driver manager.
		this.driverManager = this._register(new DataConnectionsDriverManager(extensionService));

		// Load data connection profiles from storage. Secret values stay in secret storage and are
		// fetched on demand by getProfileWithSecrets.
		this._loadProfiles();
	}

	//#endregion Constructor & Dispose

	//#region IPositronDataConnectionsService Implementation

	// Required by the DI system to make this interface structurally unique.
	declare readonly _serviceBrand: undefined;

	// Manages registered data connection drivers (register, remove, list, change events).
	readonly driverManager: IDataConnectionsDriverManager;

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
	 * Gets the parameter ids for which a secret value is stored on the given profile, without
	 * loading the values themselves.
	 * @param id The data connection profile id.
	 * @returns The list of parameter ids with stored secrets. Empty if the profile has no
	 * stored secrets (or no longer exists).
	 */
	getProfileSecretIds(id: string): readonly string[] {
		return this._readPersistedProfile(id)?.secretParameterIds ?? [];
	}

	/**
	 * Gets a display-safe, redacted form of a stored secret parameter value. Resolves the cleartext
	 * from secret storage, hands it to the driver for format-specific redaction, and returns only the
	 * redacted result. See {@link IPositronDataConnectionsService.getRedactedParameterValue}.
	 * @param id The data connection profile id.
	 * @param parameterId The id of the secret parameter to redact.
	 */
	async getRedactedParameterValue(id: string, parameterId: string): Promise<string | undefined> {
		// Resolve the profile with its secret values pulled from secret storage.
		const profile = await this.getProfileWithSecrets(id);
		if (!profile) {
			return undefined;
		}

		// Only string secret values can be redacted for display.
		const value = profile.parameterValues[parameterId];
		if (typeof value !== 'string') {
			return undefined;
		}

		// Resolve the driver, and the mechanism the connection was configured with (falling back for
		// profiles persisted before mechanisms existed).
		const driver = this.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			return undefined;
		}
		const mechanism = resolveDataConnectionMechanism(driver.metadata, profile.mechanismId);
		if (!mechanism) {
			return undefined;
		}

		// Ask the driver to redact the value. The cleartext stays within the service/driver; only the
		// redacted string is returned to the caller.
		try {
			return await driver.redactParameterValue(mechanism.id, parameterId, value);
		} catch (err) {
			this._logService.error(`[DataConnections] Failed to redact ${id}/${parameterId}: ${err}`);
			return undefined;
		}
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
	 * Opens a connection for the given profile. Looks up the driver, resolves the profile's
	 * secret parameter values, calls driver.connect(), and registers the resulting instance.
	 * If a live instance for this profile already exists, returns it without re-connecting.
	 */
	async connect(profileId: string): Promise<IDataConnectionInstance> {
		// If we already have a live instance for this profile, reuse it.
		const existing = this.getInstanceForProfile(profileId);
		if (existing) {
			return existing;
		}

		// Resolve the profile (with secrets pulled from secret storage).
		const profile = await this.getProfileWithSecrets(profileId);
		if (!profile) {
			throw new Error(`No data connection profile with id '${profileId}'`);
		}

		// Resolve the driver.
		const driver = this.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			throw new Error(`No data connection driver registered for '${profile.driverMetadata.id}'`);
		}

		// Resolve the mechanism (falling back to the first for pre-mechanisms profiles). Opening a
		// profile that predates mechanisms is a good moment to persist the resolved id, so it is
		// healed lazily without an eager migration pass.
		const mechanism = resolveDataConnectionMechanism(driver.metadata, profile.mechanismId);
		if (mechanism && !profile.mechanismId) {
			this._backfillProfileMechanismId(profileId, mechanism.id);
		}

		// Open the connection. driver.connect throws on failure; let it propagate.
		const handle = await driver.connect(mechanism?.id ?? profile.mechanismId, profile.parameterValues);

		// Build the live instance. Active starts true; an onDidChangeStatus emitter is wired so
		// future status changes can fan out to listeners (currently nothing fires it).
		const statusEmitter = this._register(new Emitter<boolean>());
		const instance: IDataConnectionInstance = {
			id: generateUuid(),
			profileId: profile.id,
			driverId: driver.id,
			driverName: driver.metadata.name,
			iconSvg: driver.metadata.iconSvg,
			connectionHandle: handle,
			active: true,
			onDidChangeStatus: statusEmitter.event,
		};

		this._instances.push(instance);
		this._logService.trace(`[DataConnections] Connected profile ${profile.id} -> instance ${instance.id}`);
		this._onDidChangeInstancesEmitter.fire([...this._instances]);

		return instance;
	}

	/**
	 * Closes the live connection for the given profile (if one exists). Calls disconnect() on
	 * the underlying handle, releases ext host resources, and removes the instance.
	 */
	async disconnect(profileId: string): Promise<void> {
		const index = this._instances.findIndex(i => i.profileId === profileId);
		if (index < 0) {
			return;
		}

		const instance = this._instances[index];
		this._instances.splice(index, 1);

		try {
			await instance.connectionHandle.disconnect();
		} catch (err) {
			// Log but don't throw -- the instance is already gone from our list and the caller
			// can't recover from a disconnect failure.
			this._logService.error(`[DataConnections] disconnect() threw for instance ${instance.id}: ${err}`);
		}
		instance.connectionHandle.release();

		this._logService.trace(`[DataConnections] Disconnected instance ${instance.id} (profile ${profileId})`);
		this._onDidChangeInstancesEmitter.fire([...this._instances]);
	}

	/**
	 * Gets all data connection instances.
	 */
	getInstances(): IDataConnectionInstance[] {
		return [...this._instances];
	}

	/**
	 * Gets a data connection instance by id.
	 */
	getInstance(id: string): IDataConnectionInstance | undefined {
		return this._instances.find(c => c.id === id);
	}

	/**
	 * Gets the live data connection instance for the given profile, or undefined if none exists.
	 */
	getInstanceForProfile(profileId: string): IDataConnectionInstance | undefined {
		return this._instances.find(i => i.profileId === profileId);
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
	 * Sets the mechanism id on an in-memory profile that lacks one (persisted before mechanisms
	 * existed) and persists the change, preserving the existing secret parameter ids. A no-op if the
	 * profile is not found. Does not fire onDidChangeProfiles: the mechanism id is internal metadata
	 * and changing it does not affect how the profile is displayed.
	 * @param id The data connection profile id.
	 * @param mechanismId The mechanism id to backfill.
	 */
	private _backfillProfileMechanismId(id: string, mechanismId: string): void {
		const profile = this._profiles.find(_ => _.id === id);
		if (!profile) {
			return;
		}
		profile.mechanismId = mechanismId;
		const secretParameterIds = this._readPersistedProfile(id)?.secretParameterIds ?? [];
		this._storageService.store(
			profileStorageKey(id),
			JSON.stringify({ profile, secretParameterIds } satisfies IPersistedDataConnectionProfile),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
		this._logService.trace(`[DataConnections] Backfilled mechanism id '${mechanismId}' for profile ${id}`);
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
		// Read the previously-persisted data connection profile so we can preserve any stored
		// secrets the form didn't touch, and clean up orphans when the driver schema changes.
		const previouslyPersistedProfile = this._readPersistedProfile(profile.id);
		const previousSecretParameterIds = new Set(previouslyPersistedProfile?.secretParameterIds ?? []);

		// Identify the current secret parameter ids from the profile's mechanism. A profile is tied to
		// a single mechanism, so only that mechanism's parameters define its secret schema.
		const driver = this.driverManager.getDriver(profile.driverMetadata.id);
		const mechanism = driver ? resolveDataConnectionMechanism(driver.metadata, profile.mechanismId) : undefined;
		const secretParamIdSet = new Set(
			mechanism?.parameters
				.filter(_ => (_.type === 'password' || _.type === 'string') && _.secret === true)
				.map(_ => _.id) ?? []
		);

		// Build the public parameter values and the new list of secret parameter ids.
		// Iterate the driver's current secret schema (not the form's parameterValues) so an absent
		// secret means "preserve existing," not "clear." A secret is only cleared by removing the
		// whole profile or by the parameter ceasing to be a secret in the driver schema.
		const publicParameterValues: typeof profile.parameterValues = {};
		for (const [key, value] of Object.entries(profile.parameterValues)) {
			if (!secretParamIdSet.has(key)) {
				publicParameterValues[key] = value;
			}
		}
		const secretParameterIds: string[] = [];
		for (const secretParamId of secretParamIdSet) {
			const submittedValue = profile.parameterValues[secretParamId];
			if (typeof submittedValue === 'string' && submittedValue.length > 0) {
				// User typed a new value; write it and record the id.
				this._secretStorageService.set(secretKey(profile.id, secretParamId), submittedValue).catch(err => {
					this._logService.error(`[DataConnections] Failed to write secret for ${profile.id}/${secretParamId}: ${err}`);
				});
				secretParameterIds.push(secretParamId);
			} else if (previousSecretParameterIds.has(secretParamId)) {
				// Form left this secret blank but a value is stored. Preserve it.
				secretParameterIds.push(secretParamId);
			}
			// Otherwise: never had a secret here, still doesn't.
		}

		// Drop orphan secrets: parameters that were previously secret but no longer are in the
		// current driver schema (driver was updated and renamed/removed/non-secreted a field).
		for (const previousSecretParameterId of previousSecretParameterIds) {
			if (!secretParamIdSet.has(previousSecretParameterId)) {
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
