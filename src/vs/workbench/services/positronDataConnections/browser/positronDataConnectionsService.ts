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
import { IEditorIdentifier } from '../../../common/editor.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IDataConnectionInstance } from '../common/interfaces/dataConnectionInstance.js';
import { PositronDataExplorerUri } from '../../positronDataExplorer/common/positronDataExplorerUri.js';
import { IPositronDataConnectionsService } from '../common/interfaces/positronDataConnectionsService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { DataConnectionParameterValues, IDataConnectionHandle, IDataConnectionProfile, isSecretParameter, resolveDataConnectionMechanism } from '../common/interfaces/dataConnectionDriver.js';
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

	// Dataset ids that previews opened in the Data Explorer, keyed by the profile whose connection
	// they were previewed from. Recorded by previewNode and dropped when the profile disconnects.
	// A recorded id outlives its editor -- the user can close the tab at any time -- so this is a
	// record of what was opened, not of what is still open; countOpenDataExplorers resolves the
	// difference against the editor service.
	private readonly _previewedDatasetIds = new Map<string, Set<string>>();

	// Profiles whose connection should close as soon as their last Data Explorer does. Populated by
	// disconnectWhenUnused, drained when an editor closes and leaves the profile with none open, and
	// cleared when the connection is wanted again or closes by another route.
	private readonly _disconnectWhenUnused = new Set<string>();

	// Fires when data connection profiles change.
	private readonly _onDidChangeProfilesEmitter = this._register(new Emitter<IDataConnectionProfile[]>());

	// Fires when data connection instances change.
	private readonly _onDidChangeInstancesEmitter = this._register(new Emitter<IDataConnectionInstance[]>());

	// Ephemeral profiles for the connections drivers report as already configured on this machine.
	// Rebuilt whenever the registered drivers change and never persisted; see
	// _refreshDiscoveredProfiles.
	private _discoveredProfiles: IDataConnectionProfile[] = [];

	// The secret parameter values of the discovered connections, keyed by discovered profile id.
	// The discovery-time analogue of secret storage: a driver's discoverConnections may report a
	// value its mechanism declares secret (e.g. a password embedded in a connection string), and
	// those never appear on the profiles the rest of the workbench sees. Held in memory only and
	// rebuilt alongside _discoveredProfiles; merged back by getProfileWithSecrets for connect(),
	// and re-attached by saveDiscoveredProfile so the save persists them into secret storage.
	private _discoveredSecretValues = new Map<string, DataConnectionParameterValues>();

	// Fires when the discovered data connections change.
	private readonly _onDidChangeDiscoveredProfilesEmitter = this._register(new Emitter<IDataConnectionProfile[]>());

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param extensionService The extension service.
	 * @param _editorService The editor service (used to see which previews are still open).
	 * @param _logService The log service.
	 * @param _secretStorageService The secret storage service (secret parameter values).
	 * @param _storageService The storage service (profile metadata).
	 */
	constructor(
		@IExtensionService extensionService: IExtensionService,
		@IEditorService private readonly _editorService: IEditorService,
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

		// A closing editor may have been the last Data Explorer holding a connection open. The event
		// fires after the editor leaves its group, so the count below already reflects the close.
		this._register(this._editorService.onDidCloseEditor(() => this._disconnectUnusedProfiles()));

		// Discovery is a property of the registered drivers, so it is re-read whenever they change:
		// when a driver's extension activates, and when a driver re-registers because what it can
		// see changed (the ODBC driver does this when odbc.ini is edited).
		this._register(this.driverManager.onDidChangeDrivers(() => this._refreshDiscoveredProfiles()));
		this._refreshDiscoveredProfiles();
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

	// Fires when the discovered data connections change.
	readonly onDidChangeDiscoveredProfiles: Event<IDataConnectionProfile[]> = this._onDidChangeDiscoveredProfilesEmitter.event;

	/**
	 * Gets the connections drivers report as already configured on this machine, as ephemeral
	 * profiles. Discoveries matching a saved profile are filtered out here rather than at refresh
	 * time, so saving or removing a profile takes effect without waiting for a re-discovery.
	 */
	getDiscoveredProfiles(): readonly IDataConnectionProfile[] {
		return this._discoveredProfiles.filter(discovered =>
			!this._profiles.some(saved => this._isSameConnection(saved, discovered)));
	}

	/**
	 * Saves a discovered connection as an ordinary profile. The saved profile gets a fresh id: the
	 * discovered id is scoped to the driver's discovery namespace, and reusing it would tie the
	 * saved profile's identity to a discovery that may later disappear.
	 * @param id The discovered profile id.
	 */
	saveDiscoveredProfile(id: string): string | undefined {
		const discovered = this._discoveredProfiles.find(_ => _.id === id);
		if (!discovered) {
			return undefined;
		}

		// Drop `discovered` and `description`: from here on this is an ordinary saved profile, and
		// leaving the marker on would keep the pane treating it as ephemeral.
		const { discovered: _discovered, description: _description, ...rest } = discovered;
		const profile: IDataConnectionProfile = {
			...rest,
			id: generateUuid(),
			createdAt: Date.now(),
			// Re-attach any secret values discovery split out, so addUpdateProfile routes them
			// into secret storage like any other saved secret.
			parameterValues: { ...rest.parameterValues, ...this._discoveredSecretValues.get(id) },
		};

		this.addUpdateProfile(profile);

		// The discovery is now shadowed by the saved profile, so the pane needs to drop its row.
		this._onDidChangeDiscoveredProfilesEmitter.fire([...this.getDiscoveredProfiles()]);

		return profile.id;
	}

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
	 * Gets the full connection catalog: the saved profiles first, then the connections drivers
	 * discovered on this machine. See {@link IPositronDataConnectionsService.getAllProfiles}.
	 */
	getAllProfiles(): readonly IDataConnectionProfile[] {
		return [...this._profiles, ...this.getDiscoveredProfiles()];
	}

	/**
	 * Gets a data connection profile by id. The returned profile's parameterValues never contains
	 * secret parameter values; use {@link getProfileWithSecrets} when those values are required.
	 * @param id The data connection profile id.
	 * @returns The matching data connection profile, or undefined if not found.
	 */
	getProfile(id: string): IDataConnectionProfile | undefined {
		// Discovered profiles are addressable by id too, so a caller holding an id from the pane can
		// resolve it without caring whether the row it came from was saved or discovered.
		return this._profiles.find(p => p.id === id) ?? this._discoveredProfiles.find(p => p.id === id);
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
			// A discovered profile has nothing in secret storage -- it was never saved. Any secret
			// values its driver reported were split out at discovery time and held in
			// _discoveredSecretValues; merge them back so the connect gets the values the driver
			// reported.
			const discovered = this._discoveredProfiles.find(_ => _.id === id);
			if (!discovered) {
				return undefined;
			}
			const secretValues = this._discoveredSecretValues.get(id);
			return secretValues === undefined
				? discovered
				: { ...discovered, parameterValues: { ...discovered.parameterValues, ...secretValues } };
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
	 * Gets display-safe, redacted forms of stored secret parameter values. Resolves the profile
	 * (with its secret values pulled from secret storage) and the driver/mechanism once, then
	 * redacts every requested parameter from that single resolution -- redacting M secrets this way
	 * costs one profile/secret-storage fetch, not M. See
	 * {@link IPositronDataConnectionsService.getRedactedParameterValues}.
	 * @param id The data connection profile id.
	 * @param parameterIds The ids of the secret parameters to redact.
	 */
	async getRedactedParameterValues(id: string, parameterIds: readonly string[]): Promise<Record<string, string>> {
		const result: Record<string, string> = {};
		if (parameterIds.length === 0) {
			return result;
		}

		// Resolve the profile with its secret values pulled from secret storage.
		const profile = await this.getProfileWithSecrets(id);
		if (!profile) {
			return result;
		}

		// Resolve the driver, and the mechanism the connection was configured with (falling back for
		// profiles persisted before mechanisms existed).
		const driver = this.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			return result;
		}
		const mechanism = resolveDataConnectionMechanism(driver.metadata, profile.mechanismId);
		if (!mechanism) {
			return result;
		}

		// Ask the driver to redact each value. The cleartext stays within the service/driver; only the
		// redacted string is returned to the caller.
		await Promise.all(parameterIds.map(async parameterId => {
			// Only string secret values can be redacted for display.
			const value = profile.parameterValues[parameterId];
			if (typeof value !== 'string') {
				return;
			}
			try {
				const redacted = await driver.redactParameterValue(mechanism.id, parameterId, value);
				if (redacted !== undefined) {
					result[parameterId] = redacted;
				}
			} catch (err) {
				this._logService.error(`[DataConnections] Failed to redact ${id}/${parameterId}: ${err}`);
			}
		}));

		return result;
	}

	/**
	 * Sets the user's preferred connection code variant for a profile and language, persisted
	 * across sessions. A no-op if the profile is not found. Does not fire onDidChangeProfiles: like
	 * the mechanism id backfill, this is metadata that does not affect how the profile is displayed
	 * in the connections list.
	 * @param profileId The data connection profile id.
	 * @param languageId The language id the variant applies to (e.g. 'python', 'r').
	 * @param variantId The id of the preferred variant.
	 */
	setPreferredCodeVariant(profileId: string, languageId: string, variantId: string): void {
		const profile = this._profiles.find(_ => _.id === profileId);
		if (!profile) {
			return;
		}

		profile.preferredCodeVariants = { ...profile.preferredCodeVariants, [languageId]: variantId };
		this._persistProfileMetadata(profile);

		this._logService.trace(`[DataConnections] Set preferred code variant for ${profileId}/${languageId}: ${variantId}`);
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

		// Close the profile's connection and its Data Explorers. Removing the profile takes its row
		// out of the Data Connections panel, so a connection left open here would stay open and
		// unreachable for the rest of the session. Fire-and-forget: the removal shouldn't wait on the
		// round trips that close the editors and the channel.
		void this.disconnect(id);

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
	 * Closes the live connection for the given profile (if one exists), along with the Data Explorers
	 * previewed from it. Calls disconnect() on the underlying handle, releases ext host resources, and
	 * removes the instance.
	 */
	async disconnect(profileId: string): Promise<void> {
		const index = this._instances.findIndex(i => i.profileId === profileId);
		if (index < 0) {
			return;
		}

		const instance = this._instances[index];
		this._instances.splice(index, 1);

		// The Data Explorers previewed from the connection close with it, because their backends die
		// with it: a tab left open would show a grid that errors on the next scroll or filter rather
		// than any useful data. Read the list while the record below is still intact.
		const editors = this._openDataExplorers(profileId);

		// The connection is going away, so its previewed datasets are no longer meaningful: the
		// driver tears their backends down, and a later reconnect mints fresh dataset ids. Any
		// pending close is moot for the same reason, whichever route brought us here.
		this._previewedDatasetIds.delete(profileId);
		this._disconnectWhenUnused.delete(profileId);

		// Closing an editor fires onDidCloseEditor, which drains the pending closes and can land back
		// here for this same profile. The splice above is what makes that a no-op, so it has to happen
		// before this await. A failure to close is logged and teardown continues: the instance is
		// already out of _instances, so bailing out here would leak the handle and leave the entry row
		// showing a connection nothing can reach.
		if (editors.length > 0) {
			try {
				await this._editorService.closeEditors(editors);
			} catch (err) {
				this._logService.error(`[DataConnections] Failed to close Data Explorers for profile ${profileId}: ${err}`);
			}
		}

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
	 * Previews a node in the Data Explorer, recording the dataset id the driver opened it under
	 * against the connection's profile.
	 */
	async previewNode(handle: IDataConnectionHandle, nodeHandle: number): Promise<string | undefined> {
		const datasetId = await handle.nodePreview(nodeHandle);
		if (datasetId === undefined) {
			return undefined;
		}

		// Attribute the dataset to the profile this handle belongs to. A handle with no live
		// instance (e.g. one already disconnected) has nothing to attribute it to; the preview
		// still happened, it just isn't tracked.
		const profileId = this._instances.find(i => i.connectionHandle === handle)?.profileId;
		if (profileId !== undefined) {
			const datasetIds = this._previewedDatasetIds.get(profileId);
			if (datasetIds) {
				datasetIds.add(datasetId);
			} else {
				this._previewedDatasetIds.set(profileId, new Set([datasetId]));
			}
		}

		return datasetId;
	}

	/**
	 * Gets how many Data Explorers are open on data previewed from the given profile's connection.
	 */
	countOpenDataExplorers(profileId: string): number {
		return this._openDataExplorers(profileId).length;
	}

	/**
	 * Closes the profile's connection as soon as nothing is using it.
	 */
	disconnectWhenUnused(profileId: string): void {
		if (this.getInstanceForProfile(profileId) === undefined) {
			return;
		}

		// Still in use: wait for the last Data Explorer to close. Otherwise close it now. Disconnect
		// is fire-and-forget either way -- callers shouldn't block on the round trip that closes the
		// channel.
		if (this.countOpenDataExplorers(profileId) > 0) {
			this._disconnectWhenUnused.add(profileId);
		} else {
			void this.disconnect(profileId);
		}
	}

	/**
	 * Cancels a pending disconnectWhenUnused for the profile.
	 */
	cancelDisconnectWhenUnused(profileId: string): void {
		this._disconnectWhenUnused.delete(profileId);
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

	//#region Private Methods

	/**
	 * Re-reads every registered driver's discovered connections and republishes them as ephemeral
	 * profiles.
	 *
	 * Discovery ids are namespaced by driver, so two drivers reporting a data source of the same
	 * name do not collide. Failures are logged and treated as "this driver found nothing": a driver
	 * whose discovery throws should not take the other drivers' discoveries down with it.
	 */
	private async _refreshDiscoveredProfiles(): Promise<void> {
		const drivers = this.driverManager.getDrivers();
		const results = await Promise.all(drivers.map(async driver => {
			try {
				const discovered = await driver.discoverConnections();
				return discovered.map(connection => {
					// A discovery's parameterValues come straight from the driver and may include
					// values its mechanism declares secret (e.g. a password embedded in a
					// connection string). Split those out, the discovery-time analogue of
					// _splitAndPersistSecrets: the profile every consumer sees stays secret-free
					// -- the catalog and code commands render its parameterValues verbatim --
					// while getProfileWithSecrets merges the secret values back for connect().
					// This also keeps _isSameConnection symmetric, since a saved profile's
					// in-memory parameterValues are secret-free too.
					const mechanism = resolveDataConnectionMechanism(driver.metadata, connection.mechanismId);
					const secretParameterIds = new Set(
						mechanism?.parameters.filter(isSecretParameter).map(parameter => parameter.id));
					const parameterValues: DataConnectionParameterValues = {};
					const secretValues: DataConnectionParameterValues = {};
					for (const [parameterId, value] of Object.entries(connection.parameterValues)) {
						(secretParameterIds.has(parameterId) ? secretValues : parameterValues)[parameterId] = value;
					}

					const profile: IDataConnectionProfile = {
						id: `discovered:${driver.id}:${connection.id}`,
						driverMetadata: {
							id: driver.metadata.id,
							name: driver.metadata.name,
							iconSvg: driver.metadata.iconSvg,
							supportedLanguageIds: driver.metadata.supportedLanguageIds,
						},
						connectionName: connection.name,
						description: connection.description,
						mechanismId: connection.mechanismId,
						parameterValues,
						discovered: true,
					};
					return { profile, secretValues };
				});
			} catch (err) {
				this._logService.error(`[DataConnections] discoverConnections() threw for driver ${driver.id}: ${err}`);
				return [];
			}
		}));

		const discoveries = results.flat();
		this._discoveredProfiles = discoveries.map(discovery => discovery.profile);
		this._discoveredSecretValues = new Map(discoveries
			.filter(discovery => Object.keys(discovery.secretValues).length > 0)
			.map(discovery => [discovery.profile.id, discovery.secretValues]));
		this._logService.trace(`[DataConnections] Discovered ${this._discoveredProfiles.length} connection(s) across ${drivers.length} driver(s)`);
		this._onDidChangeDiscoveredProfilesEmitter.fire([...this.getDiscoveredProfiles()]);
	}

	/**
	 * Whether two profiles describe the same connection: the same driver, configured the same way,
	 * with the same values. Used to suppress a discovery the user has already saved.
	 *
	 * Only the public parameter values are compared, which is all a saved profile holds in memory --
	 * its secrets live in secret storage. A discovery carries no secrets either (an ODBC data source
	 * names itself and leaves the credentials to the DSN), so the comparison is like for like.
	 */
	private _isSameConnection(saved: IDataConnectionProfile, discovered: IDataConnectionProfile): boolean {
		if (saved.driverMetadata.id !== discovered.driverMetadata.id || saved.mechanismId !== discovered.mechanismId) {
			return false;
		}

		const savedKeys = Object.keys(saved.parameterValues);
		const discoveredKeys = Object.keys(discovered.parameterValues);
		return savedKeys.length === discoveredKeys.length
			&& savedKeys.every(key => saved.parameterValues[key] === discovered.parameterValues[key]);
	}

	/**
	 * Closes the connections of any profiles waiting on their last Data Explorer, now that one has
	 * closed. A profile whose other Data Explorers are still open keeps waiting.
	 */
	private _disconnectUnusedProfiles(): void {
		// Iterate a copy: disconnect() mutates the pending set.
		for (const profileId of [...this._disconnectWhenUnused]) {
			if (this.countOpenDataExplorers(profileId) === 0) {
				void this.disconnect(profileId);
			}
		}
	}

	/**
	 * Gets the editors of the Data Explorers open on data previewed from the given profile's
	 * connection. The editor service is the authority on what is still open: a recorded dataset whose
	 * tab the user has since closed has no editors, so it doesn't appear here.
	 */
	private _openDataExplorers(profileId: string): readonly IEditorIdentifier[] {
		const datasetIds = this._previewedDatasetIds.get(profileId);
		if (datasetIds === undefined) {
			return [];
		}
		return [...datasetIds].flatMap(datasetId =>
			this._editorService.findEditors(PositronDataExplorerUri.generate(datasetId))
		);
	}

	//#endregion Private Methods

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
		this._persistProfileMetadata(profile);
		this._logService.trace(`[DataConnections] Backfilled mechanism id '${mechanismId}' for profile ${id}`);
	}

	/**
	 * Persists an in-memory profile's current fields to storage, preserving its existing secret
	 * parameter id list. Used for metadata-only updates (preferred code variant, mechanism id
	 * backfill) that don't go through {@link addUpdateProfile}'s secret-splitting logic because
	 * they never touch parameterValues.
	 * @param profile The in-memory data connection profile to persist.
	 */
	private _persistProfileMetadata(profile: IDataConnectionProfile): void {
		const secretParameterIds = this._readPersistedProfile(profile.id)?.secretParameterIds ?? [];
		this._storageService.store(
			profileStorageKey(profile.id),
			JSON.stringify({ profile, secretParameterIds } satisfies IPersistedDataConnectionProfile),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
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

		// If the mechanism can't be resolved (the driver's extension isn't registered/activated at
		// save time), fall back to the previously known secret schema instead of treating "unknown"
		// as "no secrets" -- otherwise already-secret parameter values would be persisted in
		// plaintext below.
		const secretParamIdSet = mechanism
			? new Set(mechanism.parameters
				.filter(_ => (_.type === 'password' || _.type === 'string') && _.secret === true)
				.map(_ => _.id))
			: previousSecretParameterIds;

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
