/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { SqlAnalyzer } from '../analyzer';
import { SqlLog } from '../log';
import { SqlColumn, SqlSchema, SqlTable } from '../schema';
import { SchemaIndex } from '../schemaIndex';

/** The connection every table built here belongs to, for a test that scopes a file to one. */
export const TEST_PROFILE = 'test-profile';
export const TEST_CONNECTION = 'Test Connection';
export const TEST_DRIVER = 'positron-data-driver-duckdb';

/** The analyzer, compiled once and shared: it is stateless, and compiling it is the slow part. */
let analyzer: SqlAnalyzer | undefined;

export function testAnalyzer(): SqlAnalyzer {
	const extension = vscode.extensions.getExtension('positron.positron-sql');
	if (!extension) {
		throw new Error('The positron-sql extension is not installed in this test host.');
	}
	analyzer ??= SqlAnalyzer.load(
		path.join(extension.extensionPath, 'resources', 'sql-analyzer.wasm'),
		message => { throw new Error(message); },
	);
	return analyzer;
}

/**
 * A log that keeps what was written to it.
 *
 * Every level lands in the one list: what a test asserts is that something explained a case, not
 * which severity it was explained at.
 */
export function testLog(): { log: SqlLog; messages: string[] } {
	const messages: string[] = [];
	const record = (message: string) => { messages.push(message); };
	return {
		messages,
		log: { trace: record, debug: record, info: record, warn: record, error: record },
	};
}

/** A SQL document with the given contents, for a provider to be run against. */
export function sqlDocument(content: string): Thenable<vscode.TextDocument> {
	return vscode.workspace.openTextDocument({ language: 'sql', content });
}

/**
 * A schema in the shape the connection reader produces.
 *
 * Written as `'sales.orders: id, total'` so a test's setup reads as the tables it is about rather
 * than as a page of object literals.
 */
export function schemaOf(...tables: string[]): SchemaIndex {
	return new SchemaIndex(payloadOf(...tables));
}

export function payloadOf(...tables: string[]): SqlSchema {
	return {
		tables: tables.map(parseTable),
		connections: [{ profileId: TEST_PROFILE, name: TEST_CONNECTION, driverId: TEST_DRIVER }],
		incompleteProfiles: [],
	};
}

/**
 * A payload whose one connection was read only in part.
 *
 * What a warehouse too large for the node caps produces, and what stops a name being judged
 * unknown: a table missing from it was far more likely dropped by a cap than misspelled.
 */
export function partialPayloadOf(...tables: string[]): SqlSchema {
	return { ...payloadOf(...tables), incompleteProfiles: [TEST_PROFILE] };
}

function parseTable(specification: string): SqlTable {
	// Split at the first colon only: the columns after it may carry colons of their own, a column
	// being written as `name: type`.
	const separator = specification.indexOf(':');
	const qualified = separator === -1 ? specification : specification.slice(0, separator);
	const columns = separator === -1 ? '' : specification.slice(separator + 1);
	const parts = qualified.trim().split('.');
	const name = parts.pop()!;
	return {
		name,
		schema: parts.pop(),
		catalog: parts.pop(),
		kind: 'table',
		connection: TEST_CONNECTION,
		profileId: TEST_PROFILE,
		columns: columns
			.split(',')
			.map(column => column.trim())
			.filter(column => column.length > 0)
			.map(parseColumn),
	};
}

/**
 * A column, written as `name`, `name: type`, or `name: type pk`.
 *
 * The colon rather than a space, because a column name may contain spaces -- `Order Total` is a
 * legal quoted identifier and one of these tests turns on it -- so there is nothing to split a
 * bare `name type` on. A test that does not care about types writes the name alone, which is most
 * of them.
 */
function parseColumn(specification: string): SqlColumn {
	const separator = specification.indexOf(':');
	if (separator === -1) {
		return { name: specification };
	}

	const name = specification.slice(0, separator).trim();
	let type = specification.slice(separator + 1).trim();
	const isPrimaryKey = type === 'pk' || type.endsWith(' pk');
	if (isPrimaryKey) {
		type = type.slice(0, type.length - 'pk'.length).trim();
	}
	return {
		name,
		dataType: type.length > 0 ? type : undefined,
		...(isPrimaryKey ? { isPrimaryKey } : {}),
	};
}
