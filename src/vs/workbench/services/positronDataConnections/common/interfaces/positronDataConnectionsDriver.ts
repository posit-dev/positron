/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDataConnectionNodeDTO } from './positronDataConnectionsDTOs.js';

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

	// The ID of the driver used for this connection.
	driverId: string;

	// The user-chosen name for this connection.
	connectionName: string;

	// The parameter values for this connection.
	parameterValues: DataConnectionParameterValues;
}

/**
 * A section header in the data connections list. Groups a run of profiles under a labeled
 * heading (e.g. "ACTIVE", "SAVED"). The shape is intentionally minimal -- additional fields
 * (counts, badges, etc.) can be added when the UI needs them.
 */
export interface IDataConnectionSection {
	// The label shown in the section header.
	readonly label: string;
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
 * Service-level driver metadata. Same shape as IDataConnectionDriverMetadataDTO but with the
 * richer discriminated parameter type so consumers get narrowed `parameter.type`.
 */
export interface IDataConnectionDriverMetadata {
	id: string;
	name: string;
	description: string;
	iconSvg: string;
	parameters: IDataConnectionParameter[];
	supportedLanguageIds: string[];
}

/**
 * A registered data connection driver as seen by the service layer.
 * The main thread adapter implements this.
 */
export interface IDataConnectionDriver {
	readonly id: string;
	readonly metadata: IDataConnectionDriverMetadata;
	connect(params: DataConnectionParameterValues): Promise<IDataConnectionHandle>;
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

/**
 * Manages registered data connection drivers.
 */
export interface IDataConnectionDriverManager {
	/**
	 * Registers a driver.
	 * @param driver The driver to register.
	 */
	registerDriver(driver: IDataConnectionDriver): void;

	/**
	 * Removes a driver.
	 * @param driverId The ID of the driver to remove.
	 */
	removeDriver(driverId: string): void;

	/**
	 * Gets all drivers.
	 */
	getDrivers(): IDataConnectionDriver[];

	/**
	 * Gets a driver.
	 * @param driverId The driver ID of the driver to get.
	 */
	getDriver(driverId: string): IDataConnectionDriver | undefined;

	/**
	 * Fires whenever a driver is registered or removed.
	 */
	onDidChangeDrivers: Event<IDataConnectionDriver[]>;
}
