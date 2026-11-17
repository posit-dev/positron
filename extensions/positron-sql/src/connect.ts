/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';

/**
 * The database a ggsql document says it runs against, read from its `-- @connect: <uri>` lines.
 *
 * ggsql takes the line as a directive: at the top of an execution it moves the session to that
 * database, and the session stays there. So in ggsql the connection is written in the text, and a
 * document that has the line has answered which database its tables come from -- for the editor
 * as much as for the kernel, and the same way when it renders.
 *
 * A file is read for its first such line, wherever it is: its statements run one at a time, and
 * the line rides along with the first. A Quarto cell is read for its own leading lines, as the
 * kernel reads them, and failing that for the nearest earlier `{ggsql}` or `{sql}` cell's, since
 * a document's cells share one session.
 */

/** What ggsql recognizes, to the character: the prefix is matched exactly, not loosely. */
const CONNECT_DIRECTIVE = /^\s*-- @connect:(.*)$/;

/**
 * Lines that may sit above a `@connect` line at the top of a cell without ending the directives:
 * blank lines, Quarto cell options (`--|`, `#|`), and ggsql's other directives (`-- @uncache`).
 */
const LEADING_NOISE = /^\s*($|--\||#\||-- @)/;

/** The scheme the extension host gives the cells of a notebook. */
const CELL_SCHEME = 'vscode-notebook-cell';

/** The notebook type of the hidden notebooks Positron backs Quarto documents with. */
const QUARTO_CELLS_NOTEBOOK = 'quarto-cells';

/** The languages of Quarto cells that run in ggsql, and so share a session. */
const GGSQL_CELL_LANGUAGES: ReadonlySet<string> = new Set(['sql', 'ggsql']);

/**
 * The name the Quarto extension gives the temporary file it copies a document's cells of one
 * language into, so that a language extension can be asked about them: `.vdoc.<uuid>.sql`.
 */
const QUARTO_VDOC = /^\.vdoc\.[0-9a-f-]+\.[a-z]+$/i;

/** The setting under which Positron, rather than the Quarto extension, serves a document's cells. */
const NATIVE_CELL_FEATURES_SETTING = 'quarto.embeddedLanguageFeatures.native';

/**
 * The `@connect` URI in a piece of ggsql, or undefined if it has none.
 *
 * @param leadingOnly Read only the lines at the top, where the kernel looks for directives.
 */
export function connectIn(text: string, leadingOnly: boolean): string | undefined {
	let found: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const uri = CONNECT_DIRECTIVE.exec(line)?.[1].trim();
		if (uri) {
			if (!leadingOnly) {
				return uri;
			}
			// The kernel applies each one in turn, so the last of them is where it ends up.
			found = uri;
		} else if (leadingOnly && !LEADING_NOISE.test(line)) {
			break;
		}
	}
	return found;
}

/**
 * The form a `@connect` URI is compared in, so that the line a driver writes and the line a user
 * writes match when they name the same database.
 *
 * Drivers write absolute paths, and a document kept with its data will say `duckdb://data.db`; a
 * relative file path is resolved against the document's folder, which is where Quarto runs the
 * kernel when it renders. Options after `?` are dropped: `access_mode=read_only` does not change
 * which tables there are.
 */
export function normalizeConnect(uri: string, baseDirectory: string | undefined): string {
	const withoutOptions = uri.split('?')[0].trim();
	const match = /^(duckdb|sqlite):\/\/(.+)$/i.exec(withoutOptions);
	if (!match || !baseDirectory) {
		return withoutOptions;
	}
	const [, scheme, location] = match;
	// In-memory databases and MotherDuck are not files.
	if (/^(memory|:memory:|md:)/i.test(location) || path.isAbsolute(location)) {
		return withoutOptions;
	}
	return `${scheme.toLowerCase()}://${path.resolve(baseDirectory, location)}`;
}

/** The hidden notebook a Quarto cell belongs to, if the document is one. */
function quartoNotebookOf(document: vscode.TextDocument): vscode.NotebookDocument | undefined {
	if (document.uri.scheme !== CELL_SCHEME) {
		return undefined;
	}
	return vscode.workspace.notebookDocuments.find(notebook =>
		notebook.notebookType === QUARTO_CELLS_NOTEBOOK
		&& notebook.getCells().some(cell => cell.document === document));
}

/** Whether a document is a code cell of a Quarto document. */
export function isQuartoCell(document: vscode.TextDocument): boolean {
	return document.uri.scheme === CELL_SCHEME && quartoNotebookOf(document) !== undefined;
}

/**
 * Whether a document is the Quarto extension's copy of cells that Positron already serves.
 *
 * The extension copies a document's SQL cells into a temporary file per request and asks about
 * that; Positron hands the same cells over as cells of a hidden notebook. Answering both would put
 * every completion, hover and problem in front of the user twice, and the temporary file is the
 * worse of the two: it is a new file on every request, with no way back to its document.
 */
export function isQuartoCopy(document: vscode.TextDocument): boolean {
	return document.uri.scheme === 'file'
		&& QUARTO_VDOC.test(path.basename(document.uri.fsPath))
		&& vscode.workspace.getConfiguration().get<boolean>(NATIVE_CELL_FEATURES_SETTING) === true;
}

/** Whether a document is a Quarto cell that runs in ggsql: `{ggsql}`, or `{sql}`. */
export function isGgsqlCell(document: vscode.TextDocument): boolean {
	return GGSQL_CELL_LANGUAGES.has(document.languageId) && isQuartoCell(document);
}

/** The `@connect` URI a ggsql document, or Quarto cell, runs against, if it says. */
export function declaredConnect(document: vscode.TextDocument): string | undefined {
	const notebook = quartoNotebookOf(document);
	if (!notebook) {
		return connectIn(document.getText(), false);
	}
	const cells = notebook.getCells();
	const index = cells.findIndex(cell => cell.document === document);
	for (let i = index; i >= 0; i--) {
		const cell = cells[i].document;
		if (GGSQL_CELL_LANGUAGES.has(cell.languageId)) {
			const uri = connectIn(cell.getText(), true);
			if (uri) {
				return uri;
			}
		}
	}
	return undefined;
}

/** The folder a document's relative `@connect` paths are read from, if it has one. */
export function baseDirectoryOf(document: vscode.TextDocument): string | undefined {
	const notebook = quartoNotebookOf(document);
	if (notebook) {
		// The hidden notebook is at the source document's path with `.ipynb` added.
		return path.dirname(notebook.uri.with({ scheme: 'file' }).fsPath);
	}
	return document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
}

/** The ggsql cells after this one in its Quarto document, whose connection may follow from it. */
export function laterCellsOf(document: vscode.TextDocument): vscode.TextDocument[] {
	const notebook = quartoNotebookOf(document);
	if (!notebook) {
		return [];
	}
	const cells = notebook.getCells().map(cell => cell.document);
	return cells.slice(cells.indexOf(document) + 1).filter(cell => GGSQL_CELL_LANGUAGES.has(cell.languageId));
}
