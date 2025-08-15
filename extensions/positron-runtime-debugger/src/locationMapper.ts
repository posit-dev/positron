/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';

/**
 * Represents a source location in the debug protocol.
 */
export interface Location {
	source?: DebugProtocol.Source;
	line?: number;
	endLine?: number;
}

/**
 * Translates source locations between client and runtime contexts.
 */
export interface LocationMapper {
	/**
	 * Translates a runtime location to a client location.
	 * @param location The runtime location e.g. a temporary file containing the contents of a notebook cell.
	 * @returns The client location e.g. a range of a notebook cell.
	 */
	toClientLocation<T extends Location>(location: T): T;

	/**
	 * Translates a client location to a runtime location.
	 * @param location The client location e.g. a range of a notebook cell.
	 * @returns The runtime location e.g. a temporary file containing the contents of a notebook cell.
	 */
	toRuntimeLocation<T extends Location>(location: T): T;
}
