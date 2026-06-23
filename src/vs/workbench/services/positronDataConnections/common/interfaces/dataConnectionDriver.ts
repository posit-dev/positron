/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
}

/**
 * Common fields shared by every service-level data connection parameter variant.
 */
export interface IDataConnectionParameterBase {
	id: string;
	label: string;
	required?: boolean;
}

/**
 * Service-level data connection parameter. Mirrors the public API's DataConnectionParameter
 * discriminated union: `secret` lives only on `password` and `string` variants, and a `string`
 * marked `secret: true` cannot carry a `defaultValue`. The RPC layer converts
 * IDataConnectionParameterDTO → IDataConnectionParameter at the main-thread boundary.
 */
export type IDataConnectionParameter = IDataConnectionParameterBase & (
	| { type: 'boolean'; defaultValue?: boolean }
	| { type: 'file'; defaultValue?: string; placeholder?: string }
	| { type: 'number'; defaultValue?: number; placeholder?: string }
	| { type: 'option'; options: string[]; defaultValue?: string; placeholder?: string }
	| { type: 'password'; secret: true; placeholder?: string }
	| { type: 'string'; secret?: false; defaultValue?: string; placeholder?: string }
	| { type: 'string'; secret: true; placeholder?: string }
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
	nodePreview(nodeHandle: number): Promise<void>;
	release(): void;
}