/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Analysis } from './analyzer';
import { Reference, resolveReferences } from './references';
import { SqlColumn, SqlTable } from './schema';
import { qualifiedName, SchemaIndex } from './schemaIndex';

/**
 * What the database says about the table or column under the pointer.
 *
 * The question a hover answers here is one the editor is otherwise silent about: a name in a
 * statement is just a word, and what it stands for lives in a pane the user has to leave the
 * editor to read. For a column that is its type and whether it is a key; for a table it is what
 * columns it has, which is the thing most often being looked up while writing a query.
 *
 * It is also the only place the resolution itself is visible. An unqualified `total` in a join of
 * four tables comes from exactly one of them, and until now nothing said which -- the completion
 * list offered it and the diagnostics stayed quiet, both without explaining themselves. The hover
 * names the owning table, so a query returning the wrong column has somewhere to be caught.
 *
 * Scoped to the file's connection like every other feature here, through the same
 * {@link resolveReferences} the links and diagnostics use. A name that resolved to nothing gets no
 * hover: the squiggle already says so, and a second telling in a tooltip is the same news twice.
 */

/**
 * How many of a table's columns to list.
 *
 * A hover is a tooltip, not a pane: past a screenful it stops being readable and starts covering
 * the query it is about. Wide tables exist, so what is left out is counted rather than dropped
 * silently, and the pane is still there for the whole list.
 */
const MAX_COLUMNS_SHOWN = 15;

/** Builds the hover for a position, or nothing if there is no known name under it. */
export function hoverFor(
	document: vscode.TextDocument,
	position: vscode.Position,
	analysis: Analysis,
	schema: SchemaIndex,
): vscode.Hover | undefined {
	if (schema.isEmpty) {
		return undefined;
	}

	const offset = document.offsetAt(position);
	const reference = resolveReferences(analysis, schema).find(
		candidate => offset >= candidate.start && offset <= candidate.end);
	if (!reference || reference.status !== 'resolved' || !reference.table) {
		return undefined;
	}

	const contents = describe(reference, reference.table, schema.isComplete);
	if (!contents) {
		return undefined;
	}
	return new vscode.Hover(
		contents,
		new vscode.Range(document.positionAt(reference.start), document.positionAt(reference.end)),
	);
}

/**
 * The hover text for a resolved name.
 *
 * Pure and exported: what a hover says is the whole of this feature, and it is worth reading in a
 * test rather than inferred from a screenshot.
 *
 * @param reference The name under the pointer, already resolved.
 * @param table The table it resolved to, or whose column it is.
 * @param complete Whether the schema was read in full. When it was not, a table's column list may
 *   be missing some, and a hover that showed it as the whole picture would be wrong rather than
 *   merely incomplete.
 */
export function describe(
	reference: Reference,
	table: SqlTable,
	complete: boolean,
): vscode.MarkdownString | undefined {
	return reference.kind === 'table'
		? describeTable(table, complete)
		: describeColumn(reference.name, table);
}

/** What a column is: its type, whether it is a key, and which table it came from. */
function describeColumn(name: string, table: SqlTable): vscode.MarkdownString | undefined {
	const column = table.columns.find(candidate => fold(candidate.name) === fold(name));
	if (!column) {
		// The reference resolved against this table, so its column is there. Guarded anyway
		// because a hover that throws is a hover on every keystroke that throws.
		return undefined;
	}

	// The connection's own spelling, not the user's. A name that resolved case insensitively is
	// still worth seeing as the database writes it.
	const signature = [column.name, column.dataType].filter(part => part).join(' ');
	const parts = [
		codeBlock(signature),
		vscode.l10n.t("Column of `{0}`{1}", qualifiedName(table), inConnection(table)),
	];
	if (column.isPrimaryKey) {
		parts.splice(1, 0, vscode.l10n.t("Primary key."));
	}
	return markdown(parts);
}

/** What a table is: where it lives, and what columns it has. */
function describeTable(table: SqlTable, complete: boolean): vscode.MarkdownString {
	const parts = [
		codeBlock(qualifiedName(table)),
		table.kind === 'view'
			? vscode.l10n.t("View{0}", inConnection(table))
			: vscode.l10n.t("Table{0}", inConnection(table)),
	];

	if (table.columns.length === 0) {
		// Not the same as a table with no columns, which does not exist. The schema read stopped
		// short of them, and saying so is better than showing an empty list as the answer.
		parts.push(complete
			? vscode.l10n.t("No columns were reported for this table.")
			: vscode.l10n.t("Its columns were not read; the schema was too large to read in full."));
		return markdown(parts);
	}

	parts.push(columnTable(table.columns));
	const hidden = table.columns.length - MAX_COLUMNS_SHOWN;
	if (hidden > 0) {
		parts.push(vscode.l10n.t("...and {0} more of {1} columns.", hidden, table.columns.length));
	} else if (!complete) {
		// The count is a lower bound rather than the answer: a read cut short by the node caps may
		// have dropped columns before this list was built.
		parts.push(vscode.l10n.t("The schema was too large to read in full, so there may be more."));
	}
	return markdown(parts);
}

/**
 * A table's columns as a two-column markdown table.
 *
 * A key is marked beside the name rather than in a column of its own, which would be empty for
 * most tables, and rather than by styling the name, which says nothing to a reader who has not
 * been told what the styling means.
 */
function columnTable(columns: readonly SqlColumn[]): string {
	const rows = columns.slice(0, MAX_COLUMNS_SHOWN).map(column => {
		const name = column.isPrimaryKey
			? vscode.l10n.t("{0} (key)", column.name)
			: column.name;
		return `| ${escapeCell(name)} | ${escapeCell(column.dataType ?? '')} |`;
	});
	return [
		`| ${vscode.l10n.t("Column")} | ${vscode.l10n.t("Type")} |`,
		'| --- | --- |',
		...rows,
	].join('\n');
}

/**
 * The connection a table came from, as a trailing clause.
 *
 * Left off entirely when the connection did not name itself, rather than shown as an empty
 * phrase. It is also genuinely redundant for a file scoped to one connection, which is most of
 * them -- but that is exactly the case where the user has several open and needs it.
 */
function inConnection(table: SqlTable): string {
	return table.connection ? vscode.l10n.t(" in {0}", table.connection) : '';
}

function codeBlock(text: string): string {
	return ['```sql', text, '```'].join('\n');
}

/**
 * Escapes a cell of the markdown table.
 *
 * A pipe in an identifier would end the cell early and shift every column after it. Rare, and
 * legal in a quoted identifier on every engine here.
 */
function escapeCell(text: string): string {
	return text.replace(/\|/g, '\\|');
}

function markdown(parts: readonly string[]): vscode.MarkdownString {
	return new vscode.MarkdownString(parts.join('\n\n'));
}

function fold(name: string): string {
	return name.toLowerCase();
}
