/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Analysis } from './analyzer';
import { Reference, resolveReferences } from './references';
import { SchemaIndex } from './schemaIndex';

/**
 * Diagnostics for a SQL document: two kinds, from two sources.
 *
 * Syntax problems come from the parser and are reported whatever else is known. Unknown table and
 * column names come from matching the document against the schema the user's connections
 * reported, and are reported only when that schema is a complete enough picture to judge a name
 * by: a table name against the whole schema (see {@link SchemaIndex.isComplete}), a column against
 * the table it was looked for in (see {@link SchemaIndex.columnsComplete}).
 *
 * Both are warnings. The parser is sqlparser, which is not any engine's own grammar: it rejects
 * some correct SQL in every dialect -- SQLite's `GLOB`, DuckDB's `LIMIT 10%` -- and the database
 * the statement runs on is the only real judge. The analyzer already confines syntax checking to
 * the queries sqlparser models well; a warning is the right weight for what is left.
 */

/** The diagnostic source, shown in the Problems panel beside each entry. */
const SOURCE = 'sql';

/**
 * Reports the problems in a document.
 *
 * @param analysis What the analyzer made of the document.
 * @param schema The tables the user is connected to.
 * @param reportUnknownNames The `sql.diagnostics.unknownNames` setting. The schema decides
 *   separately whether it is complete enough to judge a name at all.
 */
export function collectDiagnostics(
	document: vscode.TextDocument,
	analysis: Analysis,
	schema: SchemaIndex,
	reportUnknownNames: boolean,
): vscode.Diagnostic[] {
	const diagnostics = analysis.diagnostics.map(diagnostic => {
		const reported = new vscode.Diagnostic(
			rangeOf(document, diagnostic.start, diagnostic.end),
			diagnostic.message,
			vscode.DiagnosticSeverity.Warning,
		);
		reported.source = SOURCE;
		return reported;
	});

	if (reportUnknownNames && !schema.isEmpty) {
		for (const reference of resolveReferences(analysis, schema)) {
			// A column the resolver flags was looked for in tables whose columns were all read.
			// A table is missing from the whole schema, which says nothing if the read stopped
			// short of some of it.
			if (reference.status !== 'unknown' || (reference.kind === 'table' && !schema.isComplete)) {
				continue;
			}
			// A warning rather than an error. The schema is a snapshot of connections that can
			// change under the document, it covers only what is connected right now, and a SQL
			// file is often written against a database before it exists -- none of which makes
			// the SQL wrong the way a syntax error does.
			const reported = new vscode.Diagnostic(
				rangeOf(document, reference.start, reference.end),
				describe(reference, schema),
				vscode.DiagnosticSeverity.Warning,
			);
			reported.source = SOURCE;
			diagnostics.push(reported);
		}
	}

	return diagnostics;
}

function describe(reference: Reference, schema: SchemaIndex): string {
	if (reference.kind === 'table') {
		// A file is checked against one connection, so there is one to name, and naming it is the
		// difference between "you are wrong" and "not in this database" -- which is often what the
		// user needs to hear, the table being real and somewhere else.
		//
		// The schema is read when a connection opens, so a table created since -- from a console,
		// another tool, or this file once it has run -- is missing until it is read again. The
		// message says how, since otherwise nothing tells the user this is not the table's fault.
		const [connection] = schema.connections;
		return connection
			? vscode.l10n.t("No table named '{0}' in {1}. If it is new, run \"SQL: Refresh Database Schema\".", reference.name, connection.name)
			: vscode.l10n.t("No table named '{0}' in the connected data connection. If it is new, run \"SQL: Refresh Database Schema\".", reference.name);
	}
	return vscode.l10n.t(
		"No column named '{0}' in {1}.",
		reference.name,
		reference.searched.join(', '),
	);
}

function rangeOf(document: vscode.TextDocument, start: number, end: number): vscode.Range {
	return new vscode.Range(document.positionAt(start), document.positionAt(end));
}
