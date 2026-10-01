/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/**
 * Identifiers for the hidden notebooks that back Quarto documents, and the rule
 * that names them.
 *
 * These live in their own module, free of services, because code outside this
 * contribution has to recognize the hidden notebooks and skip them. Importing a
 * leaf module keeps those call sites from pulling in the notebook service.
 */

/**
 * View type of the hidden notebooks backing Quarto documents.
 *
 * Deliberately distinct from real notebook types. Notebook logic elsewhere in
 * the workbench keys on the view type to decide whether a notebook is one it
 * should act on, so a private type keeps these out of the way.
 */
export const QUARTO_CELLS_VIEW_TYPE = 'quarto-cells';

/**
 * URI scheme of the hidden notebooks.
 *
 * A notebook URI is its source document's URI with the scheme swapped and an
 * `.ipynb` suffix added, because a server can refuse a notebook on the strength
 * of its path alone (see `quartoNotebookUri`). The source file URI cannot be
 * reused as-is: the extension host cannot hold a text document and a notebook
 * document at the same URI.
 *
 * The path is not a way to recognize these cells. An LSP client selects them by
 * the notebook's type, and code holding a cell URI matches this scheme out of the
 * cell's fragment.
 */
export const QUARTO_CELLS_SCHEME = 'quarto-cells';

/**
 * The URI of the hidden notebook for a source document: the source URI under our
 * own scheme, since the extension host cannot hold a text document and a notebook
 * document at the same URI.
 *
 * The path ends in `.ipynb` because a server that is told about a notebook over
 * the notebook channel may still decide from the URI whether to index it at all.
 *
 * The source document's own extension is kept in front of it so the URI still says
 * where it came from, and an untitled document, which has none to keep
 * ("Untitled-1", from _Quarto: New Document_), is given a Quarto one.
 *
 * The path is not how anything tells our cells from a real notebook's. That is the
 * notebook's type, `quarto-cells`, which no other notebook has and which a document
 * selector matches directly through `notebookType`.
 *
 * Pure in the source URI, so a session can be told its notebook's URI before the
 * notebook exists; see `IRuntimeSessionMetadata.quartoNotebookUri`.
 */
export function quartoNotebookUri(sourceUri: URI): URI {
	// The same check as `isQuartoOrRmdFile`, repeated so this module imports no
	// configuration registrations.
	const lowerPath = sourceUri.path.toLowerCase();
	const quartoPath = lowerPath.endsWith('.qmd') || lowerPath.endsWith('.rmd')
		? sourceUri.path
		: `${sourceUri.path}.qmd`;
	return sourceUri.with({
		scheme: QUARTO_CELLS_SCHEME,
		path: `${quartoPath}.ipynb`,
	});
}

/**
 * Marker owner the diagnostics of the hidden cells are republished under, on the
 * source document.
 *
 * A language server publishes against the cell it was given, so its diagnostics
 * land on a URI the user cannot open. They are copied onto the document itself
 * under this owner, which keeps them apart from the owners of the diagnostics
 * that were published against the document in the first place.
 */
export const QUARTO_EMBEDDED_DIAGNOSTICS_OWNER = 'quartoEmbedded';
