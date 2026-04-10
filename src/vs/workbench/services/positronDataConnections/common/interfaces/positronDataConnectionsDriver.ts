/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';

// --- DTOs (JSON-serializable, cross the RPC wire) ---

/**
 * Serializable driver metadata sent from the ext host to the main thread
 * when a driver is registered.
 */
export interface IDataConnectionDriverMetadata {
	id: string;
	name: string;
	description: string;
	iconSvg: string;
	parameters: IDataConnectionParameterDTO[];
	supportedLanguageIds: string[];
}

/**
 * Serializable parameter definition. The discriminated union from the public
 * API is flattened so it can cross the RPC boundary.
 */
export interface IDataConnectionParameterDTO {
	id: string;
	label: string;
	required?: boolean;
	type: string; // 'string' | 'number' | 'boolean' | 'file' | 'option'
	defaultValue?: string | number | boolean;
	placeholder?: string;
	options?: string[]; // only for 'option' type
}

/**
 * Parameter values map, already plain JSON.
 */
export type DataConnectionParameterValues = Record<string, string | number | boolean>;

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

// --- Service-level interfaces ---

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
	registerDriver(driver: IDataConnectionDriver): void;
	removeDriver(driverId: string): void;
	getDrivers(): IDataConnectionDriver[];
	onDidChangeDrivers: Event<IDataConnectionDriver[]>;
}
