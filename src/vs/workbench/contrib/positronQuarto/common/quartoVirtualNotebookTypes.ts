/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identifiers for the hidden notebooks that back Quarto documents.
 *
 * These live in their own dependency-free module because code outside this
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
 * A notebook URI is its source document's URI with the scheme swapped, so the
 * path is preserved and path-pattern LSP selectors still match. The source file
 * URI cannot be reused as-is: the extension host cannot hold a text document
 * and a notebook document at the same URI.
 */
export const QUARTO_CELLS_SCHEME = 'quarto-cells';
