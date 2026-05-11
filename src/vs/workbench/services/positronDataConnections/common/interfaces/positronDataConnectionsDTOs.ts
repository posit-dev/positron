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
	secret?: boolean;
	required?: boolean;
	type: string; // 'boolean' | 'file' | 'number' | 'option' | 'password' | 'string'
	defaultValue?: string | number | boolean;
	placeholder?: string;
	options?: string[]; // only for 'option' type
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
	parameters: IDataConnectionParameterDTO[];
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
	hasGetChildren: boolean;
	hasPreview: boolean;
}

/**
 * A lightweight summary of a registered driver, returned to the ext host
 * for the positron.dataConnections.getDrivers() API.
 */
export interface IDataConnectionDriverSummaryDTO {
	id: string;
	name: string;
	description: string;
	parameters: IDataConnectionParameterDTO[];
	supportedLanguageIds: string[];
}
