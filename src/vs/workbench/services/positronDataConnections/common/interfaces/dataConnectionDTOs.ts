/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// --- DTOs (JSON-serializable, cross the RPC wire) ---
//
// Everything in this file is part of the wire contract between the extension host and the
// main thread. DTOs should NEVER leak into service-layer or UI code - consumers there import
// from positronDataConnectionsDriver.ts instead, and the main-thread adapter converts at the
// boundary.

/**
 * Serializable parameter definition. The discriminated union from the public
 * API is flattened so it can cross the RPC boundary.
 */
export interface IDataConnectionParameterDTO {
	id: string;
	label: string;
	description?: string;
	secret?: boolean;
	masked?: boolean; // only for secret 'string' type; defaults to true when omitted
	required?: boolean;
	type: string; // 'boolean' | 'file' | 'number' | 'option' | 'password' | 'string'
	defaultValue?: string | number | boolean;
	placeholder?: string;
	options?: string[]; // only for 'option' type
	filters?: Record<string, string[]>; // only for 'file' type; file-picker filters, label -> extensions
}

/**
 * Serializable configuration mechanism definition. Carries the mechanism's identity and its own
 * set of parameters.
 */
export interface IDataConnectionMechanismDTO {
	id: string;
	label: string;
	description: string;
	parameters: IDataConnectionParameterDTO[];
}

/**
 * Serializable driver metadata sent from the ext host to the main thread when a driver is
 * registered. Converted to the richer service-level IDataConnectionDriverMetadata at the
 * main-thread boundary.
 */
export interface IDataConnectionDriverMetadataDTO {
	id: string;
	name: string;
	description: string;
	iconSvg: string;
	mechanisms: IDataConnectionMechanismDTO[];
	supportedLanguageIds: string[];
}

/**
 * Parameter values map, already plain JSON. Currently shape-identical to the service-level
 * DataConnectionParameterValues; kept as a distinct DTO alias so the wire contract can evolve
 * independently.
 */
export type DataConnectionParameterValuesDTO = Record<string, string | number | boolean>;

/**
 * Serializable node returned from getChildren calls. Each node gets a handle
 * so the main thread can call back for child expansion and preview.
 */
export interface IDataConnectionNodeDTO {
	nodeHandle: number;
	name: string;
	kind: string; // DataConnectionNodeKind value
	dataType?: string;
	isPrimaryKey?: boolean;
	hasGetChildren: boolean;
	hasPreview: boolean;
}

/**
 * Serializable form of a single named connection code variant (e.g. Python `sqlite3` vs
 * `SQLAlchemy`). A generateConnectionCode call returns an ordered list of these; an empty list
 * means code cannot be generated from the given parameters.
 */
export interface IDataConnectionCodeVariantDTO {
	// A stable identifier for the variant, unique within the returned list.
	id: string;

	// A user-facing label for the variant.
	label: string;

	// The generated connection code for this variant.
	code: string;
}

/**
 * Serializable form of a connection a driver found already configured on this machine (e.g. an
 * ODBC data source declared in odbc.ini). Converted to an ephemeral IDataConnectionProfile at the
 * main-thread boundary; never persisted unless the user saves it.
 */
export interface IDiscoveredDataConnectionDTO {
	// Unique within the driver and stable across sessions. Namespaced by driver id on the main
	// thread, so it need not be globally unique.
	id: string;

	// The name to show in the pane.
	name: string;

	// An optional one-line summary of where the connection points.
	description?: string;

	// The id of the mechanism to connect with. One of the driver's mechanisms.
	mechanismId: string;

	// The parameter values to connect with.
	parameters: DataConnectionParameterValuesDTO;
}

/**
 * A lightweight summary of a registered driver, returned to the ext host
 * for the positron.dataConnections.getDrivers() API.
 */
export interface IDataConnectionDriverSummaryDTO {
	id: string;
	name: string;
	description: string;
	mechanisms: IDataConnectionMechanismDTO[];
	supportedLanguageIds: string[];
}
