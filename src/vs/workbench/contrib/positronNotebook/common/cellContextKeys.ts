/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/** All cell context keys in one place so we can easily operate on them all at once. */
export namespace CellContextKeys {
	export const isCode = new RawContextKey<boolean>('positronNotebookCellIsCode', false);
	export const isMarkdown = new RawContextKey<boolean>('positronNotebookCellIsMarkdown', false);
	/** A cell of type 'raw' i.e. one that contains plain text without any rendered outputs or execution capabilities. */
	export const isRaw = new RawContextKey<boolean>('positronNotebookCellIsRaw', false);
	export const isRunning = new RawContextKey<boolean>('positronNotebookCellIsRunning', false);
	export const isPending = new RawContextKey<boolean>('positronNotebookCellIsPending', false);
	export const isFirst = new RawContextKey<boolean>('positronNotebookCellIsFirst', false);
	export const isLast = new RawContextKey<boolean>('positronNotebookCellIsLast', false);
	export const isOnly = new RawContextKey<boolean>('positronNotebookCellIsOnly', false);
	/** True when the markdown editor of a cell is open for editing. */
	export const markdownEditorOpen = new RawContextKey<boolean>('positronNotebookCellMarkdownEditorOpen', false);
	/** True when a cell is selected (relevant for multi-cell selection scenarios). */
	export const isSelected = new RawContextKey<boolean>('positronNotebookCellIsSelected', false);
	/** True when the cell is the active/focused cell (displays its action bar and receives cell-level keyboard actions). */
	export const isActive = new RawContextKey<boolean>('positronNotebookCellIsActive', false);
	export const canMoveUp = new RawContextKey<boolean>('positronNotebookCellCanMoveUp', false);
	export const canMoveDown = new RawContextKey<boolean>('positronNotebookCellCanMoveDown', false);
	export const hasOutputs = new RawContextKey<boolean>('positronNotebookCellHasOutputs', false);
	export const imageOutputCount = new RawContextKey<number>('positronNotebookCellImageOutputCount', 0);
	export const jsonOutputCount = new RawContextKey<number>('positronNotebookCellJsonOutputCount', 0);
	export const outputIsCollapsed = new RawContextKey<boolean>('positronNotebookCellOutputIsCollapsed', false);
	export const outputOverflows = new RawContextKey<boolean>('positronNotebookCellOutputOverflows', false, localize('positronNotebookCellOutputOverflows', "Whether the cell's text output exceeds the line limit"));
	export const outputScrolling = new RawContextKey<boolean>('positronNotebookCellOutputScrolling', false, localize('positronNotebookCellOutputScrolling', "Whether the cell's output is in scrolling mode"));
	/** Set when a cell's output section has DOM focus. */
	export const outputFocused = new RawContextKey<boolean>('positronNotebookOutputFocused', false, localize('positronNotebookOutputFocused', "Whether a cell's output area has focus"));
	/** Set when the user right-clicks on an image in the output area, or opens the ellipsis menu for a cell with image output. */
	export const outputImageTargeted = new RawContextKey<boolean>('positronNotebookOutputImageTargeted', false);
	/** Set when the user right-clicks on JSON output or opens the ellipsis menu for a cell with JSON output. */
	export const outputJsonTargeted = new RawContextKey<boolean>('positronNotebookOutputJsonTargeted', false);
}
