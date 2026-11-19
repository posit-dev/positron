/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataConnectionNodeKind } from '../../positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * The runtime languages whose live connections are shown in Data Connections.
 */
export const RUNTIME_DATA_CONNECTION_LANGUAGES = ['r', 'python'] as const;

/**
 * A language that has a runtime data connection driver.
 */
export type RuntimeConnectionLanguage = typeof RUNTIME_DATA_CONNECTION_LANGUAGES[number];

/**
 * The mechanism id of a live runtime connection.
 */
export const RUNTIME_CONNECTION_MECHANISM_ID = 'live';

/**
 * The connection parameter that holds the id of the runtime connection.
 */
export const RUNTIME_CONNECTION_ID_PARAMETER = 'connectionId';

/**
 * Whether a language id has a runtime data connection driver.
 * @param languageId The language id to check.
 */
export function isRuntimeConnectionLanguage(languageId: string | undefined): languageId is RuntimeConnectionLanguage {
	return RUNTIME_DATA_CONNECTION_LANGUAGES.some(language => language === languageId);
}

/**
 * Gets the id of the runtime data connection driver for a language.
 * @param languageId The runtime language.
 */
export function runtimeDataConnectionDriverId(languageId: RuntimeConnectionLanguage): string {
	return `runtime-${languageId}`;
}

/**
 * Whether a driver id belongs to a runtime data connection driver.
 * @param driverId The driver id to check.
 */
export function isRuntimeDataConnectionDriverId(driverId: string): boolean {
	return RUNTIME_DATA_CONNECTION_LANGUAGES.some(language => runtimeDataConnectionDriverId(language) === driverId);
}

/**
 * Maps a node kind from the connections contract to a data connection node kind. The contract
 * uses non-table kinds only for containers, so unknown kinds map to Schema, which has a
 * container icon.
 * @param contractKind The kind reported by the connections contract, in any case.
 */
export function toDataConnectionNodeKind(contractKind: string): DataConnectionNodeKind {
	switch (contractKind.toLowerCase()) {
		case 'catalog':
			return DataConnectionNodeKind.Catalog;
		case 'database':
			return DataConnectionNodeKind.Database;
		case 'table':
			return DataConnectionNodeKind.Table;
		case 'view':
			return DataConnectionNodeKind.View;
		case 'field':
			return DataConnectionNodeKind.Field;
		default:
			return DataConnectionNodeKind.Schema;
	}
}

let runtimeConnectionHandleCounter = 0;

/**
 * Gets the next runtime connection handle. Handles are negative (-1, -2, ...) and come from one
 * counter shared by every runtime driver, so they never collide with each other or with
 * extension host handles.
 */
export function nextRuntimeConnectionHandle(): number {
	return --runtimeConnectionHandleCounter;
}
