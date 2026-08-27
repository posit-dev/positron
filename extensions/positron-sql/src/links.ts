/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Analysis } from './analyzer';
import { Reference, resolveReferences } from './references';
import { SqlTable } from './schema';
import { qualifiedName, SchemaIndex } from './schemaIndex';

/**
 * Document links that reveal a table or column in Positron's Data Connections pane.
 *
 * Ctrl/Cmd-clicking one of these runs a command rather than opening a document: Positron's link
 * handling opens link targets with commands allowed, so a `command:` target is followed like any
 * other link. That is what makes the gesture available on a plain name in the middle of a
 * statement -- go-to-definition cannot do it, since it has to answer with a location in a file.
 *
 * A link is only offered for a name that resolved to a table the connection said came from a
 * specific profile, because revealing means naming which pane row to walk to.
 */

/**
 * The workbench command a link runs. Owned by Positron core, not by this extension: following a
 * link runs it with the profile and path of the row to reveal.
 */
const REVEAL_COMMAND = 'positronDataConnections.revealNode';

/**
 * What the pane calls each level of its tree, matching `DataConnectionNodeKind` in positron.d.ts.
 *
 * A path is expressed in these terms because a node's id is not stable across a refetch -- it
 * embeds a per-fetch handle -- so the only durable way to name a row is its kinds and names from
 * the connection down.
 */
const CATALOG = 'catalog';
const SCHEMA = 'schema';
const FIELD = 'field';

interface PathSegment {
	readonly kind: string;
	readonly name: string;
}

/** Builds the links for a document from what the analyzer and the schema made of it. */
export function collectLinks(
	document: vscode.TextDocument,
	analysis: Analysis,
	schema: SchemaIndex,
): vscode.DocumentLink[] {
	if (schema.isEmpty) {
		return [];
	}

	const links: vscode.DocumentLink[] = [];
	for (const reference of resolveReferences(analysis, schema)) {
		const link = linkFor(document, reference);
		if (link) {
			links.push(link);
		}
	}
	return links;
}

function linkFor(document: vscode.TextDocument, reference: Reference): vscode.DocumentLink | undefined {
	if (reference.status !== 'resolved' || !reference.table) {
		return undefined;
	}
	const table = reference.table;
	if (!table.profileId) {
		// The table came from a connection that did not say which profile it belongs to, so there
		// is no tree to walk. Completions still work; only the link is unavailable.
		return undefined;
	}

	const path = tablePath(table);
	let tooltip: string;
	if (reference.kind === 'column') {
		path.push({ kind: FIELD, name: reference.name });
		tooltip = vscode.l10n.t('Reveal {0} in {1}', reference.name, qualifiedName(table));
	} else {
		tooltip = vscode.l10n.t('Reveal {0} in Data Connections', qualifiedName(table));
	}

	const link = new vscode.DocumentLink(
		new vscode.Range(document.positionAt(reference.start), document.positionAt(reference.end)),
		revealUri(table.profileId, path),
	);
	link.tooltip = tooltip;
	return link;
}

/** The pane path of a table, using whichever namespace levels the connection reported. */
function tablePath(table: SqlTable): PathSegment[] {
	const path: PathSegment[] = [];
	if (table.catalog) {
		path.push({ kind: CATALOG, name: table.catalog });
	}
	if (table.schema) {
		path.push({ kind: SCHEMA, name: table.schema });
	}
	path.push({ kind: table.kind, name: table.name });
	return path;
}

/**
 * Builds the `command:` URI that reveals a row when the link is followed.
 *
 * Positron parses the query as the JSON array of the command's arguments, so the whole payload is
 * one encoded component; nothing is left unescaped, since a table name can contain any character
 * a URI gives meaning to.
 */
function revealUri(profileId: string, path: readonly PathSegment[]): vscode.Uri {
	const args = JSON.stringify([{ profileId, path }]);
	return vscode.Uri.parse(`command:${REVEAL_COMMAND}?${encodeURIComponent(args)}`);
}
