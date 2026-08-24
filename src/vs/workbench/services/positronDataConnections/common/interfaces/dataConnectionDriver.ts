/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileFilter } from '../../../../../platform/dialogs/common/dialogs.js';
import { IDataConnectionNodeDTO } from './dataConnectionDTOs.js';

// --- Service-level interfaces ---
//
// All wire-format types (DTOs) live in positronDataConnectionsDTOs.ts. Consumers here are
// service/UI code and should not import DTOs directly; the main-thread adapter converts at
// the RPC boundary. The one exception is IDataConnectionHandle's getChildren methods, which
// forward raw node DTOs straight from the ext host.

/**
 * Parameter values map. Currently shape-identical to DataConnectionParameterValuesDTO; kept as
 * a distinct service-level alias so the in-process representation can evolve independently.
 */
export type DataConnectionParameterValues = Record<string, boolean | number | string>;

/**
 * A data connection profile. A profile has its persistence metadata (id, createdAt, lastUsedAt)
 * once stored; for a draft (not yet saved) those fields are undefined. Distinct from
 * IDataConnectionInstance, which represents the live/connected form at runtime.
 */
export interface IDataConnectionProfile {
	// Stable identifier for the connection. Assigned once at draft creation and preserved
	// through save; never changes for a given connection.
	readonly id: string;

	// Epoch millis the connection was saved. Undefined for drafts.
	readonly createdAt?: number;

	// Epoch millis the connection was last used. Undefined until first use.
	lastUsedAt?: number;

	// The driver metadata for this connection.
	driverMetadata: Pick<IDataConnectionDriverMetadata, 'id' | 'name' | 'iconSvg' | 'supportedLanguageIds'>;

	// The user-chosen name for this connection.
	connectionName: string;

	// The id of the mechanism this connection was configured with. One of the driver's mechanisms.
	mechanismId: string;

	// The parameter values for this connection.
	parameterValues: DataConnectionParameterValues;

	// The user's preferred connection code variant per language (languageId -> variant id), from
	// the driver's generateConnectionCode results. Optional: existing profiles predate this field,
	// and languages the user has never picked a variant for are absent. Callers fall back to
	// variants[0] when a language has no stored preference.
	preferredCodeVariants?: Record<string, string>;

	// Set when this profile was reported by a driver's discoverConnections rather than saved by the
	// user. A discovered profile is ephemeral: it is not persisted, it disappears when the driver
	// stops reporting it, and the pane offers to save it rather than to remove it. Absent on every
	// saved profile.
	readonly discovered?: true;

	// A one-line summary of where a discovered connection points, supplied by the driver. Only ever
	// set alongside `discovered`.
	readonly description?: string;

	// The id of the discovery this profile was saved from, set by saveDiscoveredProfile and
	// persisted with the profile. This is what suppresses the discovery's own row once it has been
	// saved: the two profiles cannot be matched by comparing values, since a discovery's secret
	// values are held aside and a saved profile's live in secret storage, so the one field that
	// distinguishes two otherwise identical data sources is invisible to both. Absent on a profile
	// the user configured by hand.
	readonly discoveredFromId?: string;
}

/**
 * Common fields shared by every service-level data connection parameter variant.
 */
export interface IDataConnectionParameterBase {
	id: string;
	label: string;
	description?: string;
	required?: boolean;
}

/**
 * Service-level data connection parameter. Mirrors the public API's DataConnectionParameter
 * discriminated union: `secret` lives only on `password` and `string` variants, and a `string`
 * marked `secret: true` cannot carry a `defaultValue`. The RPC layer converts
 * IDataConnectionParameterDTO → IDataConnectionParameter at the main-thread boundary; the `file`
 * variant's filters dictionary becomes an ordered FileFilter array there so UI consumers can pass
 * it straight to the file dialog service.
 */
export type IDataConnectionParameter = IDataConnectionParameterBase & (
	| { type: 'boolean'; defaultValue?: boolean }
	| { type: 'file'; defaultValue?: string; placeholder?: string; filters?: FileFilter[] }
	| { type: 'number'; defaultValue?: number; placeholder?: string }
	| { type: 'option'; options: string[]; defaultValue?: string; placeholder?: string }
	| { type: 'password'; secret: true; placeholder?: string }
	| { type: 'string'; secret?: false; defaultValue?: string; placeholder?: string }
	| { type: 'string'; secret: true; masked?: boolean; placeholder?: string }
);

/**
 * Type guard for a parameter that holds a secret value (e.g. a password). Secret parameters carry
 * `secret: true`; non-secret parameters either omit the field or set it to `false`.
 * @param parameter The parameter to test.
 */
export function isSecretParameter(parameter: IDataConnectionParameter): boolean {
	return parameter.type === 'password' || (parameter.type === 'string' && parameter.secret === true);
}

/**
 * Service-level configuration mechanism. Same shape as IDataConnectionMechanismDTO but with the
 * richer discriminated parameter type so consumers get narrowed `parameter.type`.
 */
export interface IDataConnectionMechanism {
	id: string;
	label: string;
	description: string;
	parameters: IDataConnectionParameter[];
}

/**
 * Service-level driver metadata. Same shape as IDataConnectionDriverMetadataDTO but with the
 * richer discriminated parameter type so consumers get narrowed `parameter.type`.
 */
export interface IDataConnectionDriverMetadata {
	id: string;
	name: string;
	description: string;
	iconSvg: string;
	mechanisms: IDataConnectionMechanism[];
	supportedLanguageIds: string[];
}

/**
 * Resolves the mechanism a profile was configured with. Falls back to the driver's first mechanism
 * when the id is missing or unknown: profiles persisted before mechanisms existed carry no
 * mechanismId, and historically a driver had exactly one parameter set, which is now its first
 * mechanism. Returns undefined only if the driver exposes no mechanisms.
 * @param metadata The driver metadata to resolve against.
 * @param mechanismId The profile's mechanism id, or undefined for a pre-mechanisms profile.
 */
export function resolveDataConnectionMechanism(metadata: IDataConnectionDriverMetadata, mechanismId: string | undefined): IDataConnectionMechanism | undefined {
	return metadata.mechanisms.find(_ => _.id === mechanismId) ?? metadata.mechanisms[0];
}

/**
 * Service-level form of a single named connection code variant. Same shape as
 * IDataConnectionCodeVariantDTO; kept distinct so the in-process representation can evolve
 * independently of the wire contract.
 */
export interface IDataConnectionCodeVariant {
	// A stable identifier for the variant, unique within the returned list.
	id: string;

	// A user-facing label for the variant.
	label: string;

	// The generated connection code for this variant.
	code: string;
}

/**
 * A registered data connection driver as seen by the service layer.
 * The main thread adapter implements this.
 */
export interface IDataConnectionDriver {
	readonly id: string;
	readonly metadata: IDataConnectionDriverMetadata;
	connect(mechanismId: string, params: DataConnectionParameterValues): Promise<IDataConnectionHandle>;

	/**
	 * Generates the available connection code variants for the given language using the selected
	 * mechanism and the provided parameter values. Callers should only invoke this for drivers that
	 * report at least one supported language (see
	 * {@link IDataConnectionDriverMetadata.supportedLanguageIds}); the underlying driver rejects the
	 * call when it does not implement code generation. Variants are returned in preference order
	 * (first is the default); an empty array means code cannot be generated from the given parameters.
	 * @param mechanismId The id of the mechanism the user selected.
	 * @param languageId One of the driver's supported language ids.
	 * @param params The current connection parameter values.
	 */
	generateConnectionCode(mechanismId: string, languageId: string, params: DataConnectionParameterValues): Promise<IDataConnectionCodeVariant[]>;

	/**
	 * Produces a display-safe, redacted form of a stored parameter value (e.g. masking the password
	 * embedded in a connection string) for display in the configuration dialog and in the
	 * agent-facing connection catalog. The cleartext value is passed to the driver in the ext host;
	 * only the redacted result returns. Resolves to undefined when the driver does not implement
	 * redaction, or has nothing to redact in this value.
	 *
	 * Called for every parameter, not only the ones the mechanism declares secret: a credential can
	 * sit inside an ordinary `string` parameter (an ODBC connection string embedding `PWD=`), and
	 * only the driver knows its own formats well enough to find it. A driver that masks such values
	 * should do so here regardless of how the parameter is declared.
	 * @param mechanismId The id of the mechanism the connection was configured with.
	 * @param parameterId The id of the parameter to redact.
	 * @param value The stored cleartext parameter value.
	 */
	redactParameterValue(mechanismId: string, parameterId: string, value: string): Promise<string | undefined>;

	/**
	 * Lists the connections this driver found already configured on the machine (e.g. ODBC data
	 * sources). Resolves to an empty array for the drivers that do not implement discovery, which is
	 * most of them.
	 */
	discoverConnections(): Promise<IDiscoveredDataConnection[]>;
}

/**
 * Service-level form of a connection a driver found already configured on this machine. Converted
 * to an ephemeral IDataConnectionProfile by the service, which owns the id namespacing and the
 * deduplication against saved profiles.
 */
export interface IDiscoveredDataConnection {
	// Unique within the driver and stable across sessions.
	id: string;

	// The name to show in the pane.
	name: string;

	// An optional one-line summary of where the connection points.
	description?: string;

	// The id of the mechanism to connect with. One of the driver's mechanisms.
	mechanismId: string;

	// The parameter values to connect with.
	parameterValues: DataConnectionParameterValues;
}

/**
 * A live connection handle. Wraps proxy calls back to the ext host for
 * tree browsing, disconnect, etc.
 */
export interface IDataConnectionHandle {
	readonly handle: number;
	isReadOnly(): Promise<boolean>;
	getChildren(): Promise<IDataConnectionNodeDTO[]>;
	disconnect(): Promise<void>;
	isConnected(): Promise<boolean>;
	nodeGetChildren(nodeHandle: number): Promise<IDataConnectionNodeDTO[]>;
	/**
	 * Previews a node's data in the Data Explorer. Resolves to the dataset id the preview was
	 * opened under, or undefined when the driver did not report one.
	 */
	nodePreview(nodeHandle: number): Promise<string | undefined>;
	release(): void;
}