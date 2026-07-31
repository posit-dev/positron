/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { kernelToLanguageId } from './quartoParser.js';

/**
 * The notebook view type of Quarto shadow notebooks.
 *
 * A shadow notebook mirrors the code cells of an open Quarto/R Markdown text
 * document so that extension-host language clients receive standard
 * notebookDocument/didOpen and didChange notifications with
 * `vscode-notebook-cell` URIs, with zero changes required in language
 * extensions. The notebook shares the .qmd file's URI and is never shown in
 * an editor.
 */
export const QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE = 'quarto-shadow';

/**
 * Map a Quarto fence language (e.g. `python`, `python3`, `r`) to a VS Code
 * language ID for the mirrored notebook cell. Unknown fence languages pass
 * through lowercased so servers registered for them still match.
 */
export function fenceLanguageToCellLanguage(fenceLanguage: string): string {
	return kernelToLanguageId(fenceLanguage) ?? fenceLanguage.toLowerCase();
}

/**
 * A language + text snapshot of one shadow notebook cell, used to reconcile
 * the notebook against the freshly parsed Quarto document.
 */
export interface ShadowCellSpec {
	/** VS Code language ID of the cell. */
	readonly language: string;

	/** Full cell text (fence body without the fence lines). */
	readonly text: string;
}

/**
 * Replace `deleteCount` cells at `index` with `cells`. Used for structural
 * changes (add/remove/reorder/language change) where cell identity cannot be
 * preserved.
 */
export interface ShadowCellSplice {
	readonly kind: 'splice';
	readonly index: number;
	readonly deleteCount: number;
	readonly cells: readonly ShadowCellSpec[];
}

/**
 * In-place text edit of the cell at `index`: replace the character range
 * [start, end) of the old cell text with `text`. Preserves the cell (and its
 * ext-host document), so language servers see an incremental didChange
 * instead of a close/open pair.
 */
export interface ShadowCellEdit {
	readonly kind: 'edit';
	readonly index: number;
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/** An action needed to bring the shadow notebook in line with a new parse. */
export type ShadowSyncAction = ShadowCellSplice | ShadowCellEdit;

/** Whether two cell snapshots are identical (language and text). */
function cellsEqual(a: ShadowCellSpec, b: ShadowCellSpec): boolean {
	return a.language === b.language && a.text === b.text;
}

/**
 * Compute the minimal single-range text edit that turns `oldText` into
 * `newText` by trimming the common prefix and suffix.
 * @returns Character offsets into `oldText` plus the replacement text, or
 * undefined when the texts are equal.
 */
export function computeMinimalTextEdit(oldText: string, newText: string): { start: number; end: number; text: string } | undefined {
	if (oldText === newText) {
		return undefined;
	}

	// Common prefix.
	const maxPrefix = Math.min(oldText.length, newText.length);
	let prefix = 0;
	while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
		prefix++;
	}

	// Common suffix, bounded so it never overlaps the prefix.
	const maxSuffix = Math.min(oldText.length, newText.length) - prefix;
	let suffix = 0;
	while (suffix < maxSuffix && oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) {
		suffix++;
	}

	return {
		start: prefix,
		end: oldText.length - suffix,
		text: newText.substring(prefix, newText.length - suffix),
	};
}

/**
 * Reconcile the shadow notebook's current cells against a fresh parse of the
 * Quarto document.
 *
 * The algorithm anchors on identical cells at the start and end of both
 * lists, leaving a middle window of differing cells. If the window has the
 * same length and pairwise-matching languages, each differing cell gets an
 * in-place text edit (preserving cell identity and server-side state).
 * Otherwise the whole window is replaced with one splice.
 *
 * Notes:
 * - Cells are matched by position and language, never keyed by content hash:
 *   an edited cell is an edit of the same cell, not a remove+insert.
 * - Reordering same-language cells is indistinguishable from editing them
 *   without content keying, so it surfaces as in-place edits. Reordering
 *   cells of different languages surfaces as a splice.
 * @returns At most one splice, or any number of in-place edits. Edit indices
 * are valid in both the old and new cell lists (window lengths are equal).
 */
export function computeShadowSyncActions(oldCells: readonly ShadowCellSpec[], newCells: readonly ShadowCellSpec[]): ShadowSyncAction[] {
	// Anchor: common prefix of identical cells.
	const maxPrefix = Math.min(oldCells.length, newCells.length);
	let prefix = 0;
	while (prefix < maxPrefix && cellsEqual(oldCells[prefix], newCells[prefix])) {
		prefix++;
	}

	// Anchor: common suffix of identical cells (never overlapping the prefix).
	const maxSuffix = Math.min(oldCells.length, newCells.length) - prefix;
	let suffix = 0;
	while (suffix < maxSuffix && cellsEqual(oldCells[oldCells.length - 1 - suffix], newCells[newCells.length - 1 - suffix])) {
		suffix++;
	}

	const oldWindowLength = oldCells.length - prefix - suffix;
	const newWindowLength = newCells.length - prefix - suffix;

	// Identical lists.
	if (oldWindowLength === 0 && newWindowLength === 0) {
		return [];
	}

	// Same shape and languages: edit cells in place.
	const languagesMatch = oldWindowLength === newWindowLength
		&& oldCells.slice(prefix, prefix + oldWindowLength)
			.every((cell, i) => cell.language === newCells[prefix + i].language);
	if (languagesMatch) {
		const edits: ShadowSyncAction[] = [];
		for (let i = 0; i < oldWindowLength; i++) {
			const index = prefix + i;
			const edit = computeMinimalTextEdit(oldCells[index].text, newCells[index].text);
			if (edit) {
				edits.push({ kind: 'edit', index, ...edit });
			}
		}
		return edits;
	}

	// Structural change: replace the window with one splice.
	return [{
		kind: 'splice',
		index: prefix,
		deleteCount: oldWindowLength,
		cells: newCells.slice(prefix, newCells.length - suffix),
	}];
}
