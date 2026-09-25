/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Reads Snowflake's shared connections.toml file, where each top-level TOML table is a named
// connection (e.g. `[TestData]`). This is the same file the snowflake-connector-python and the
// snowflake-sdk read; surfacing its named connections lets the driver reuse credentials the user has
// already configured for the CLI/connector rather than re-entering them in the connection form.
//
// The file lives at $SNOWFLAKE_HOME/connections.toml, defaulting to ~/.snowflake/connections.toml --
// the same resolution snowflake-sdk uses in loadConnectionConfiguration(). Parsing is kept here (pure
// filesystem + TOML) and separate from the driver so the driver can own the mapping to
// SnowflakeConnectionOptions, which reuses its account-normalization helper.

import { readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as toml from 'toml';

/** A single named connection's raw key/value table, as read from connections.toml. */
export type SnowflakeConnectionsFileEntry = Record<string, unknown>;

/**
 * Resolves the connections.toml path, honoring $SNOWFLAKE_HOME and otherwise defaulting to
 * ~/.snowflake, matching snowflake-sdk's own resolution.
 */
export function connectionsFilePath(): string {
	const home = process.env.SNOWFLAKE_HOME && process.env.SNOWFLAKE_HOME.length > 0
		? process.env.SNOWFLAKE_HOME
		: path.join(os.homedir(), '.snowflake');
	return path.join(home, 'connections.toml');
}

/**
 * Parses connections.toml content into a map of connection name to its raw entry, preserving file
 * order. Only top-level tables (objects) are treated as connections; any stray scalar keys are
 * ignored.
 */
export function parseConnectionsFile(content: string): Record<string, SnowflakeConnectionsFileEntry> {
	// toml.parse is typed as returning `any`; narrow it at the boundary.
	const parsed = toml.parse(content) as Record<string, unknown>;
	const result: Record<string, SnowflakeConnectionsFileEntry> = {};
	for (const [name, value] of Object.entries(parsed)) {
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			result[name] = value as SnowflakeConnectionsFileEntry;
		}
	}
	return result;
}

/**
 * Reads and parses the connections file, returning an empty map when the file does not exist.
 * Callers treat "no connections" and "no file" the same way (the mechanism simply offers nothing).
 *
 * A file that exists but cannot be read or parsed throws instead. A TOML typo, or a file caught
 * half-written, is not the same as a file with no connections in it: treating it as empty would
 * drop every connection the file defines until the next good read.
 */
export function readConnectionsFile(filePath: string): Record<string, SnowflakeConnectionsFileEntry> {
	let content: string;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return {};
		}
		throw err;
	}
	return parseConnectionsFile(content);
}

/**
 * Whether two readings of the file define the same connections.
 *
 * Used to tell a real edit from a file event that changed nothing, so the pane is only asked to
 * refresh the driver when the named connections -- or the values behind them -- actually changed.
 *
 * @param a One reading.
 * @param b The other.
 * @returns True when a driver updated with `b` would offer exactly what `a` offered.
 */
export function isSameConnectionsFile(
	a: Record<string, SnowflakeConnectionsFileEntry>,
	b: Record<string, SnowflakeConnectionsFileEntry>
): boolean {
	// Both sides come from the same parser, which preserves file order, so a structural comparison
	// of the serialized form is exact. A reordered file counts as a change: the order is what the
	// connection picker lists.
	return JSON.stringify(a) === JSON.stringify(b);
}
