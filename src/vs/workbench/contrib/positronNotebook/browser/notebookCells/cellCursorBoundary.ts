/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

/** Cursor position relative to the editor's first/last view line. */
export type CursorAtBoundary = 'none' | 'top' | 'bottom' | 'both';

/** Cursor position relative to the start/end of its line. */
export type CursorAtLineBoundary = 'none' | 'start' | 'end' | 'both';

/**
 * Whether the cursor is on the editor's first and/or last view line.
 * Compares view-line tops rather than model line numbers so word-wrapped
 * lines are handled: a cursor on the first wrapped segment of the last model
 * line is not at the bottom. Mirrors `cursorAtBoundary` in the upstream
 * notebook's baseCellViewModel.
 */
export function computeCursorAtBoundary(editor: ICodeEditor): CursorAtBoundary {
	const model = editor.getModel();
	const selection = editor.getSelection();
	if (!model || !selection || !selection.isEmpty()) {
		return 'none';
	}

	const cursorTop = editor.getTopForPosition(selection.positionLineNumber, selection.positionColumn);
	const firstViewLineTop = editor.getTopForPosition(1, 1);
	const lastLine = model.getLineCount();
	const lastViewLineTop = editor.getTopForPosition(lastLine, model.getLineMaxColumn(lastLine));

	const atTop = cursorTop === firstViewLineTop;
	const atBottom = cursorTop === lastViewLineTop;
	if (atTop && atBottom) {
		return 'both';
	}
	if (atTop) {
		return 'top';
	}
	if (atBottom) {
		return 'bottom';
	}
	return 'none';
}

/**
 * Whether the cursor is at the start and/or end of its model line.
 * Mirrors `cursorAtLineBoundary` in the upstream notebook's baseCellViewModel.
 */
export function computeCursorAtLineBoundary(editor: ICodeEditor): CursorAtLineBoundary {
	const model = editor.getModel();
	const selection = editor.getSelection();
	if (!model || !selection || !selection.isEmpty()) {
		return 'none';
	}

	const atStart = selection.positionColumn === 1;
	const atEnd = selection.positionColumn === model.getLineMaxColumn(selection.positionLineNumber);
	if (atStart && atEnd) {
		return 'both';
	}
	if (atStart) {
		return 'start';
	}
	if (atEnd) {
		return 'end';
	}
	return 'none';
}
