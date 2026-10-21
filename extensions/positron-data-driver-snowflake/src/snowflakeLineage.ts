/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Lineage for a Snowflake connection, read with SNOWFLAKE.CORE.GET_LINEAGE: the table function
// behind the Snowsight Lineage tab (Enterprise Edition and up). Each row it returns is one edge,
// source to target, with its distance from the requested object.
//
// https://docs.snowflake.com/en/sql-reference/functions/get_lineage-snowflake-core

import * as positron from 'positron';
import * as vscode from 'vscode';
import { isStatementError, SnowflakeClient } from './snowflakeClient.js';
import { quoteIdentifier, quoteLiteral } from './snowflakeNodes.js';

/**
 * Reads one end of an edge from a GET_LINEAGE row, by column prefix (`SOURCE` or `TARGET`). The
 * database and schema are NULL for an object outside Snowflake, and the column is NULL for an edge
 * between objects; each stays absent rather than becoming the string "null".
 * @param row The GET_LINEAGE row.
 * @param prefix Which end to read.
 */
function lineageObject(row: Record<string, unknown>, prefix: 'SOURCE' | 'TARGET'): positron.DataConnectionLineageObject {
	const text = (value: unknown) => value === null || value === undefined ? undefined : String(value);
	const domain = (text(row[`${prefix}_OBJECT_DOMAIN`]) ?? '').toLowerCase();
	// A masked object is one the role may not see. Snowflake fills its database, schema, name and
	// column with `***` placeholders rather than leaving them empty; they are not names, so they are
	// left out rather than passed on to be read as one.
	if (text(row[`${prefix}_STATUS`])?.toUpperCase() === 'MASKED') {
		return { domain, masked: true };
	}
	return {
		database: text(row[`${prefix}_OBJECT_DATABASE`]),
		schema: text(row[`${prefix}_OBJECT_SCHEMA`]),
		name: text(row[`${prefix}_OBJECT_NAME`]),
		column: text(row[`${prefix}_COLUMN_NAME`]),
		// Lowercased to match how Positron spells kinds elsewhere; Snowflake reports e.g. `TABLE`,
		// `VIEW`, `STAGE`, `EXTERNAL_TABLE`.
		domain,
	};
}

/**
 * Snowflake's reason for not tracking an object's lineage that can be told from its path alone:
 * the metadata views in a database's INFORMATION_SCHEMA, and the SNOWFLAKE database's own objects.
 * GET_LINEAGE answers for these with an empty result rather than an error, which would read as "no
 * lineage" -- so they are declined up front instead.
 * @param path The object's path.
 */
function untrackedByPath(path: string[]): string | undefined {
	if (path[1] === 'INFORMATION_SCHEMA') {
		return vscode.l10n.t('Snowflake does not track lineage for objects in INFORMATION_SCHEMA.');
	}
	if (path[0] === 'SNOWFLAKE') {
		return vscode.l10n.t('Snowflake does not track lineage for objects in the SNOWFLAKE database.');
	}
	return undefined;
}

/**
 * Whether a database is shared into this account (an imported database, e.g. from the
 * Marketplace), whose objects Snowflake does not track lineage for. GET_LINEAGE answers for those
 * with an empty result rather than an error, so an empty result is checked against this before it
 * is reported as "no lineage". SHOW DATABASES LIKE matches case-insensitively and with wildcards, so
 * the rows are filtered to the exact name. A statement error -- the role can't show the database --
 * leaves the empty result standing.
 * @param client The client.
 * @param database The database's exact name.
 */
async function isSharedDatabase(client: SnowflakeClient, database: string): Promise<boolean> {
	try {
		// quoteLiteral escapes the string literal, not the LIKE pattern: `_` and `%` stay wildcards,
		// which the exact-name filter below makes harmless, and a backslash becomes a LIKE escape,
		// so a shared database whose name contains one goes undetected and reads as "no lineage".
		const { rows } = await client.query(`SHOW DATABASES LIKE ${quoteLiteral(database)}`);
		const row = rows.find(candidate => candidate.name === database);
		return String(row?.kind ?? '').toUpperCase() === 'IMPORTED DATABASE';
	} catch (error) {
		if (!isStatementError(error)) {
			throw error;
		}
		return false;
	}
}

// The GET_LINEAGE columns lineageObject reads, for each end of an edge.
const END_COLUMNS = ['OBJECT_DATABASE', 'OBJECT_SCHEMA', 'OBJECT_NAME', 'OBJECT_DOMAIN', 'COLUMN_NAME', 'STATUS'];

// The columns the query selects: the distance, then both ends.
const SELECTED_COLUMNS = ['DISTANCE', ...['SOURCE', 'TARGET'].flatMap(end => END_COLUMNS.map(column => `${end}_${column}`))];

// The order edges come back in: nearest first, and within a distance by the names at each end, so
// a cut at maxEdges keeps the same edges every time rather than whichever the server returned first.
const ORDER_COLUMNS = ['DISTANCE', ...['SOURCE', 'TARGET'].flatMap(end =>
	['OBJECT_DATABASE', 'OBJECT_SCHEMA', 'OBJECT_NAME', 'COLUMN_NAME'].map(column => `${end}_${column}`))];

/**
 * Reads an object's lineage.
 *
 * The object is named by its path, each part quoted -- the way the rest of this driver names
 * objects -- so a lowercase or mixed-case name (common for tables written from pandas) resolves to
 * the object it names, not to its uppercased namesake. A Snowflake object is always three parts,
 * and a column four; any other path is declined with a message saying so. The arguments are bound
 * rather than spliced into the SQL.
 *
 * GET_LINEAGE caps its own output only at ten million rows, so the query is bounded here: ordered
 * nearest first (see ORDER_COLUMNS), and limited to one more row than asked for, so a full page can
 * be told from a truncated one.
 *
 * Snowflake rejects the statement -- with a SQL state -- when the object doesn't exist or isn't
 * accessible, isn't in the given domain, doesn't support lineage, or the account isn't Enterprise
 * Edition. That is an answer, not a failure, and comes back as `available: false` carrying
 * Snowflake's message. Anything else (a dead session, a closed client) rejects, as the tree does.
 *
 * For an object Snowflake doesn't track lineage for at all -- INFORMATION_SCHEMA, the SNOWFLAKE
 * database, a shared database -- GET_LINEAGE returns an empty result instead, which would read as
 * "no lineage". Those are declined too, with a message saying why (see untrackedByPath and
 * isSharedDatabase).
 * @param client The client.
 * @param request The lineage request.
 */
export async function getSnowflakeLineage(
	client: SnowflakeClient,
	request: positron.DataConnectionLineageRequest,
): Promise<positron.DataConnectionLineage> {
	const expectedParts = request.domain === 'column' ? 4 : 3;
	if (request.path.length !== expectedParts) {
		return {
			available: false,
			message: request.domain === 'column'
				? vscode.l10n.t('Snowflake names a column as database.schema.table.column.')
				: vscode.l10n.t('Snowflake names a table or view as database.schema.table.'),
		};
	}

	const untracked = untrackedByPath(request.path);
	if (untracked) {
		return { available: false, message: untracked };
	}

	const limit = Math.max(1, Math.floor(request.maxEdges));
	let rows: Record<string, unknown>[];
	try {
		rows = (await client.query(
			`SELECT ${SELECTED_COLUMNS.join(', ')} FROM TABLE(SNOWFLAKE.CORE.GET_LINEAGE(?, ?, ?, ?)) ORDER BY ${ORDER_COLUMNS.join(', ')} LIMIT ${limit + 1}`,
			[request.path.map(quoteIdentifier).join('.'), request.domain.toUpperCase(), request.direction.toUpperCase(), request.depth],
		)).rows;
	} catch (error) {
		if (!isStatementError(error)) {
			throw error;
		}
		return { available: false, message: error instanceof Error ? error.message : String(error) };
	}

	if (rows.length === 0 && await isSharedDatabase(client, request.path[0])) {
		return {
			available: false,
			message: vscode.l10n.t('Snowflake does not track lineage for objects in a shared database ({0}).', request.path[0]),
		};
	}

	return {
		available: true,
		edges: rows.slice(0, limit).map(row => ({
			source: lineageObject(row, 'SOURCE'),
			target: lineageObject(row, 'TARGET'),
			distance: Number(row.DISTANCE),
		})),
		truncated: rows.length > limit,
	};
}
