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
 * Serializable form of a request to generate query code: run this query, through this connection,
 * in this language. A request object rather than four positional strings, because every field is a
 * string and transposing two of them yields code that runs the wrong thing.
 */
export interface IDataConnectionQueryCodeRequestDTO {
	// The language to generate code for. One of the driver's supported language ids.
	readonly languageId: string;

	// The id of the connection code variant the connection was made with, so the generated code
	// matches the object that variant created (a SQLAlchemy engine is not queried like a DBAPI
	// connection, though both come from the same driver).
	readonly variantId: string;

	// The name of the variable the connection is bound to in the session.
	readonly connectionVariable: string;

	// The query to run, as the user wrote it. The driver quotes it for the target language.
	readonly query: string;
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

/**
 * A connection the user has configured, as reported to an extension by
 * `positron.dataConnections.getConnections`.
 *
 * Deliberately holds no parameter values, redacted or otherwise. An extension asks for this to
 * find out what the user is connected to, not how they connected, and a payload that carries a
 * host name or an account identifier is one every consumer then has to be careful with.
 */
export interface IDataConnectionSummaryDTO {
	/** Stable identifier for the connection, and the key for every other call about it. */
	readonly profileId: string;

	/** The user-chosen name for the connection. */
	readonly name: string;

	readonly driverId: string;
	readonly driverName: string;

	/** Whether the connection is live right now. Only a live one has a schema to read. */
	readonly connected: boolean;

	/**
	 * The languages the driver can generate connection code for, e.g. `['python', 'r']`. These are
	 * the languages a session can hold this connection in; empty for a driver that generates none.
	 */
	readonly supportedLanguageIds: string[];
}

/**
 * A connection a runtime session holds: which variable, in which session, created by which
 * connection code variant.
 *
 * A data connection is opened by its driver in the extension host, not inside the user's R or
 * Python session. A session gets its own connection only when connection code runs there, which is
 * what this records -- everything needed to write further code against that connection.
 */
export interface IDataConnectionSessionBindingDTO {
	/** The profile the connection is to. */
	readonly profileId: string;

	/** The session holding it, and the one to run code against it in. */
	readonly sessionId: string;

	/** The language the connection code was written in. */
	readonly languageId: string;

	/**
	 * The connection code variant it was made with, e.g. `sqlalchemy`. Absent when Positron did
	 * not make the connection and so cannot know; code generated against such a binding assumes
	 * the driver's preferred variant for the language.
	 */
	readonly variantId?: string;

	/**
	 * The name of the variable the connection is bound to. Parsed from the code that ran rather
	 * than assumed, because the user can edit that code before running it.
	 */
	readonly variableName: string;
}
