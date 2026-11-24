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
 * the line rides along with the first. A Quarto cell is not read here at all: which cells run in
 * ggsql, and which database each runs against (its own line, or one it inherits from an earlier
 * cell), is decided by Positron, which runs them, and handed over in the hidden notebook's cell
 * metadata, so that the tables a cell completes from are those it runs against.
 */

/** What ggsql recognizes, to the character: the prefix is matched exactly, not loosely. */
const CONNECT_DIRECTIVE = /^\s*-- @connect:(.*)$/;

/** The scheme the extension host gives the cells of a notebook. */
const CELL_SCHEME = 'vscode-notebook-cell';

/** The notebook type of the hidden notebooks Positron backs Quarto documents with. */
const QUARTO_CELLS_NOTEBOOK = 'quarto-cells';

/**
 * The cell metadata key under which Positron gives a Quarto cell that runs in ggsql the `@connect`
 * URI it runs against, or an empty string when it names none; absent from any other cell.
 * Positron's `QUARTO_CELL_GGSQL_CONNECT_KEY`.
 */
const GGSQL_CONNECT_KEY = 'ggsqlConnect';

/**
 * The name the Quarto extension gives the temporary file it copies a document's cells of one
 * language into, so that a language extension can be asked about them: `.vdoc.<uuid>.sql`.
 */
const QUARTO_VDOC = /^\.vdoc\.[0-9a-f-]+\.[a-z]+$/i;

/** The setting under which Positron, rather than the Quarto extension, serves a document's cells. */
const NATIVE_CELL_FEATURES_SETTING = 'quarto.embeddedLanguageFeatures.native';

/** The first `@connect` URI in a piece of ggsql, wherever it is, or undefined if it has none. */
export function connectIn(text: string): string | undefined {
	for (const line of text.split(/\r?\n/)) {
		const uri = CONNECT_DIRECTIVE.exec(line)?.[1].trim();
		if (uri) {
			return uri;
		}
	}
	return undefined;
}

/**
 * The form a `@connect` URI is compared in, so that the line a driver writes and the line a user
 * writes match when they name the same database.
 *
 * Drivers write absolute paths, and a document kept with its data will say `duckdb://data.db`; a
 * relative file path is resolved against the document's folder, which is where Quarto runs the
 * kernel when it renders. Options after `?` are dropped: `access_mode=read_only` does not change
 * which tables there are. A file path is compared with forward slashes and a lowercase drive
 * letter: drivers write the former, and a document's `fsPath` gives the latter.
 *
 * @param pathApi The platform's path module; Windows' in tests.
 */
export function normalizeConnect(uri: string, baseDirectory: string | undefined, pathApi: path.PlatformPath = path): string {
	const withoutOptions = uri.split('?')[0].trim();
	const match = /^(?<scheme>duckdb|sqlite):\/\/(?<location>.+)$/i.exec(withoutOptions);
	if (!match?.groups) {
		return withoutOptions;
	}
	const { scheme, location } = match.groups;
	// In-memory databases and MotherDuck are not files.
	if (/^(memory|:memory:|md:)/i.test(location)) {
		return withoutOptions;
	}
	const resolved = pathApi.isAbsolute(location) || !baseDirectory ? location : pathApi.resolve(baseDirectory, location);
	const comparable = resolved.replace(/\\/g, '/').replace(/^[a-z]:/i, drive => drive.toLowerCase());
	return `${scheme.toLowerCase()}://${comparable}`;
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

/** The hidden notebook cell a document is, if it is a code cell of a Quarto document. */
function quartoCellOf(document: vscode.TextDocument): vscode.NotebookCell | undefined {
	return quartoNotebookOf(document)?.getCells().find(cell => cell.document === document);
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

/**
 * Whether a document is a Quarto cell that runs in ggsql: a `{ggsql}` cell, or a `{sql}` cell
 * in a document that does not render with knitr, as Positron decides it.
 */
export function isGgsqlCell(document: vscode.TextDocument): boolean {
	return typeof quartoCellOf(document)?.metadata[GGSQL_CONNECT_KEY] === 'string';
}

/** The `@connect` URI a ggsql document, or Quarto cell, runs against, if it says. */
export function declaredConnect(document: vscode.TextDocument): string | undefined {
	if (!isQuartoCell(document)) {
		return connectIn(document.getText());
	}
	const uri = quartoCellOf(document)?.metadata[GGSQL_CONNECT_KEY];
	return typeof uri === 'string' && uri ? uri : undefined;
}

/**
 * The Quarto cells whose database a change to a hidden notebook moved, whichever cell's text
 * moved it: Positron works the databases out again for the whole document.
 */
export function cellsWithNewConnect(event: vscode.NotebookDocumentChangeEvent): vscode.TextDocument[] {
	if (event.notebook.notebookType !== QUARTO_CELLS_NOTEBOOK) {
		return [];
	}
	return event.cellChanges.filter(change => change.metadata !== undefined).map(change => change.cell.document);
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
