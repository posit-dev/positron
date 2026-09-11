/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { IDataConnectionInstance } from './dataConnectionInstance.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { DataConnectionParameterValues, IDataConnectionHandle, IDataConnectionProfile } from './dataConnectionDriver.js';
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

	// Fires when the discovered data connections change.
	onDidChangeDiscoveredProfiles: Event<IDataConnectionProfile[]>;

	/**
	 * Gets the connections drivers report as already configured on this machine (e.g. ODBC data
	 * sources), as ephemeral profiles. These are not persisted and are never returned by
	 * {@link getProfiles}. A discovery the user has already saved is omitted, so a data source the
	 * user has configured appears once. Two things suppress a discovery: the saved profile records
	 * which discovery it was saved from (see {@link saveDiscoveredProfile}), which survives renaming
	 * and editing it; and, for a connection the user configured by hand instead, a match on driver,
	 * mechanism, name, and values. The name is part of that match because the secret values that
	 * would otherwise distinguish two same-shaped data sources are held out of both profiles, so
	 * without it, saving either one would hide both.
	 * Like a saved profile's, the returned profiles' parameterValues never contain values the
	 * mechanism declares secret; those are held internally and merged back by
	 * {@link getProfileWithSecrets}.
	 * @returns The discovered data connection profiles.
	 */
	getDiscoveredProfiles(): readonly IDataConnectionProfile[];

	/**
	 * Gets the full connection catalog: every saved profile followed by every discovered
	 * connection. The single owner of the "saved first, discovered after" ordering that the pane
	 * and the payload commands both present -- a user's own saved connections keep the top, since
	 * on a machine with a large odbc.ini the discoveries can outnumber them several times over.
	 * Which discoveries are dropped is {@link getDiscoveredProfiles}'s to decide.
	 * @returns The saved profiles followed by the discovered profiles.
	 */
	getAllProfiles(): readonly IDataConnectionProfile[];

	/**
	 * Saves a discovered connection as an ordinary profile, so it persists across sessions and can
	 * be edited and removed. The discovered entry stops being reported separately once saved: the
	 * saved profile records the discovery it came from. A no-op if the id is not a current
	 * discovery.
	 * @param id The discovered profile id.
	 * @returns The id of the saved profile, or undefined if the discovery was not found.
	 */
	saveDiscoveredProfile(id: string): string | undefined;

	/**
	 * Adds or updates a data connection profile. An edit that changes a value the profile's live
	 * connection was opened with closes that connection, since it no longer represents the profile;
	 * {@link wouldCloseConnection} reports that in advance.
	 * @param profile The data connection profile to add or update.
	 */
	addUpdateProfile(profile: IDataConnectionProfile): void;

	/**
	 * Whether saving the given profile would close its live connection: true when a connection is
	 * open and the edit changes a value it was opened with. Use it to warn the user before a save
	 * takes their Data Explorers down with the connection.
	 * @param profile The edited data connection profile, as it would be passed to addUpdateProfile.
	 */
	wouldCloseConnection(profile: IDataConnectionProfile): boolean;

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
	 * Gets display-safe, redacted forms of stored secret parameter values, for showing as
	 * placeholders when editing an existing connection (e.g. a connection string with its password
	 * masked). The cleartext values are resolved from secret storage and passed to the driver, which
	 * performs the format-specific redaction; only the redacted results are returned. The cleartext
	 * is never exposed to callers. Resolves the profile once for all requested parameters, so
	 * redacting M secrets costs one profile/secret-storage fetch rather than M.
	 * @param id The data connection profile id.
	 * @param parameterIds The ids of the secret parameters to redact.
	 * @returns A map of parameter id to its redacted string. A parameter is omitted when it has no
	 * stored value or the driver does not implement redaction.
	 */
	getRedactedParameterValues(id: string, parameterIds: readonly string[]): Promise<Record<string, string>>;

	/**
	 * Gets the profile's full parameter values in display-safe form, for showing the connection to
	 * something other than the user who configured it (the agent-facing connection catalog). Every
	 * parameter is offered to the driver for redaction, not only the ones the mechanism declares
	 * secret, because a credential can sit inside an ordinary `string` parameter -- an ODBC
	 * connection string embedding `PWD=` -- and only the driver knows its own formats. A value the
	 * driver redacts appears in its redacted form; a value it does not is passed through when the
	 * parameter is non-secret, and omitted when it is secret.
	 *
	 * When the driver or mechanism cannot be resolved, nothing can be redacted, so this falls back
	 * to the profile's own secret-free parameterValues rather than risking a cleartext passthrough.
	 *
	 * Takes the profile rather than its id so a caller iterating a catalog snapshot gets the values
	 * of the profile it is rendering. Discovered profiles come and go as drivers refresh discovery,
	 * and an id looked up again after an await can already be gone.
	 * @param profile The data connection profile.
	 * @returns The display-safe parameter values.
	 */
	getDisplayParameterValues(profile: IDataConnectionProfile): Promise<DataConnectionParameterValues>;

	/**
	 * Sets the user's preferred connection code variant for a profile and language, persisted
	 * across sessions. Used to initialize the variant selector in the Connect With dialog, and by
	 * the getConnections command to report the profile's chosen package per language. A no-op if
	 * the profile is not found.
	 * @param profileId The data connection profile id.
	 * @param languageId The language id the variant applies to (e.g. 'python', 'r').
	 * @param variantId The id of the preferred variant, from the driver's generateConnectionCode results.
	 */
	setPreferredCodeVariant(profileId: string, languageId: string, variantId: string): void;

	/**
	 * Removes a data connection profile, deleting its persisted settings and stored secrets. Also
	 * closes anything still using it: the Data Explorers previewed from its connection, and then the
	 * connection itself, since a removed profile leaves no UI to manage a connection from. Callers
	 * should confirm with the user first -- none of this is recoverable.
	 * @param id The data connection profile id to remove.
	 */
	removeProfile(id: string): void;

	/**
	 * Opens a connection for the given profile. Looks up the driver, resolves the profile's
	 * secret parameter values, calls driver.connect(), and registers the resulting instance.
	 * If a live instance for this profile already exists, returns it without re-connecting.
	 * @param profileId The data connection profile id to connect.
	 * @returns The live data connection instance.
	 * @throws If the profile is not found, the driver is not registered, or driver.connect() fails.
	 */
	connect(profileId: string): Promise<IDataConnectionInstance>;

	/**
	 * Closes the live connection for the given profile (if one exists). Calls disconnect() on
	 * the underlying handle, releases ext host resources, and removes the instance from the
	 * service. No-op if no instance exists for the profile.
	 *
	 * The Data Explorers previewed from the connection close with it: their backends die with the
	 * connection, so leaving one open would leave a grid that errors on the next scroll or filter.
	 * Use {@link disconnectWhenUnused} instead to give up a connection without cutting those off.
	 * @param profileId The data connection profile id to disconnect.
	 */
	disconnect(profileId: string): Promise<void>;

	/**
	 * Previews a node in the Data Explorer, recording the dataset id the driver opened it under
	 * against the connection's profile so {@link countOpenDataExplorers} can report it later. Callers
	 * should preview through this method rather than calling handle.nodePreview() directly, so no
	 * Data Explorer goes unrecorded.
	 * @param handle The connection handle the node belongs to.
	 * @param nodeHandle The handle of the node to preview.
	 * @returns The dataset id the preview was opened under, or undefined if the driver reported none.
	 */
	previewNode(handle: IDataConnectionHandle, nodeHandle: number): Promise<string | undefined>;

	/**
	 * Gets how many Data Explorers are open on data previewed from the given profile's connection.
	 * Counts only previews the driver reported a dataset id for, and only those whose editor is still
	 * open -- the user closing a Data Explorer tab brings the count back down.
	 * @param profileId The data connection profile id.
	 */
	countOpenDataExplorers(profileId: string): number;

	/**
	 * Closes the profile's connection as soon as nothing is using it: right away when it has no open
	 * Data Explorers, otherwise once the last one is closed. Lets a caller give up its own use of a
	 * connection without cutting off the Data Explorers still reading from it. No-op if the profile
	 * has no live connection. Cancel a pending close with {@link cancelDisconnectWhenUnused}.
	 * @param profileId The data connection profile id.
	 */
	disconnectWhenUnused(profileId: string): void;

	/**
	 * Cancels a pending {@link disconnectWhenUnused} for the profile, keeping its connection open.
	 * Call this when the connection is wanted again (e.g. the user re-expanded it). No-op if no close
	 * is pending.
	 * @param profileId The data connection profile id.
	 */
	cancelDisconnectWhenUnused(profileId: string): void;

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
	 * Gets the live data connection instance for the given profile, or undefined if none exists.
	 * @param profileId The data connection profile id.
	 */
	getInstanceForProfile(profileId: string): IDataConnectionInstance | undefined;
}
