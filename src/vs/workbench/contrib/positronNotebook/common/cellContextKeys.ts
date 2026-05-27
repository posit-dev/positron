/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/** All cell context keys in one place so we can easily operate on them all at once. */
export namespace CellContextKeys {
	export const isCode = new RawContextKey<boolean>('positronNotebookCellIsCode', false, { type: 'boolean', description: localize('positronNotebookCellIsCode', "Whether the cell is a code cell") });
	export const isMarkdown = new RawContextKey<boolean>('positronNotebookCellIsMarkdown', false, { type: 'boolean', description: localize('positronNotebookCellIsMarkdown', "Whether the cell is a markdown cell") });
	/** A cell of type 'raw' i.e. one that contains plain text without any rendered outputs or execution capabilities. */
	export const isRaw = new RawContextKey<boolean>('positronNotebookCellIsRaw', false, { type: 'boolean', description: localize('positronNotebookCellIsRaw', "Whether the cell is a raw cell i.e. one that contains plain text without any rendered outputs or execution capabilities") });
	export const isRunning = new RawContextKey<boolean>('positronNotebookCellIsRunning', false, { type: 'boolean', description: localize('positronNotebookCellIsRunning', "Whether the cell is currently running") });
	export const isPending = new RawContextKey<boolean>('positronNotebookCellIsPending', false, { type: 'boolean', description: localize('positronNotebookCellIsPending', "Whether the cell is pending execution") });
	export const isFirst = new RawContextKey<boolean>('positronNotebookCellIsFirst', false, { type: 'boolean', description: localize('positronNotebookCellIsFirst', "Whether the cell is the first cell in the notebook") });
	export const isLast = new RawContextKey<boolean>('positronNotebookCellIsLast', false, { type: 'boolean', description: localize('positronNotebookCellIsLast', "Whether the cell is the last cell in the notebook") });
	export const isOnly = new RawContextKey<boolean>('positronNotebookCellIsOnly', false, { type: 'boolean', description: localize('positronNotebookCellIsOnly', "Whether the cell is the only cell in the notebook") });
	/** True when the markdown editor of a cell is open for editing. */
	export const markdownEditorOpen = new RawContextKey<boolean>('positronNotebookCellMarkdownEditorOpen', false, { type: 'boolean', description: localize('positronNotebookCellMarkdownEditorOpen', "Whether the markdown editor of a cell is open for editing") });
	/** True when a cell is selected (relevant for multi-cell selection scenarios). */
	export const isSelected = new RawContextKey<boolean>('positronNotebookCellIsSelected', false, { type: 'boolean', description: localize('positronNotebookCellIsSelected', "Whether the cell is selected") });
	/** True when the cell is the active/focused cell (displays its action bar and receives cell-level keyboard actions). */
	export const isActive = new RawContextKey<boolean>('positronNotebookCellIsActive', false, { type: 'boolean', description: localize('positronNotebookCellIsActive', "Whether the cell is the active cell") });
	export const canMoveUp = new RawContextKey<boolean>('positronNotebookCellCanMoveUp', false, { type: 'boolean', description: localize('positronNotebookCellCanMoveUp', "Whether the cell can be moved up") });
	export const canMoveDown = new RawContextKey<boolean>('positronNotebookCellCanMoveDown', false, { type: 'boolean', description: localize('positronNotebookCellCanMoveDown', "Whether the cell can be moved down") });
	export const hasOutputs = new RawContextKey<boolean>('positronNotebookCellHasOutputs', false, { type: 'boolean', description: localize('positronNotebookCellHasOutputs', "Whether the cell has any outputs") });
	export const imageOutputCount = new RawContextKey<number>('positronNotebookCellImageOutputCount', 0, { type: 'number', description: localize('positronNotebookCellImageOutputCount', "The number of image outputs in the cell") });
	export const jsonOutputCount = new RawContextKey<number>('positronNotebookCellJsonOutputCount', 0, { type: 'number', description: localize('positronNotebookCellJsonOutputCount', "The number of JSON outputs in the cell") });
	export const outputIsCollapsed = new RawContextKey<boolean>('positronNotebookCellOutputIsCollapsed', false, { type: 'boolean', description: localize('positronNotebookCellOutputIsCollapsed', "Whether the cell output is collapsed") });
	export const outputOverflows = new RawContextKey<boolean>('positronNotebookCellOutputOverflows', false, { type: 'boolean', description: localize('positronNotebookCellOutputOverflows', "Whether the cell's text output exceeds the line limit") });
	export const outputScrolling = new RawContextKey<boolean>('positronNotebookCellOutputScrolling', false, { type: 'boolean', description: localize('positronNotebookCellOutputScrolling', "Whether the cell's output is in scrolling mode") });
	/** Set when a cell's output section has DOM focus. */
	export const outputFocused = new RawContextKey<boolean>('positronNotebookOutputFocused', false, { type: 'boolean', description: localize('positronNotebookOutputFocused', "Whether a cell's output area has focus") });
	/** Set when the user right-clicks on an image in the output area, or opens the ellipsis menu for a cell with image output. */
	export const outputImageTargeted = new RawContextKey<boolean>('positronNotebookOutputImageTargeted', false, { type: 'boolean', description: localize('positronNotebookOutputImageTargeted', "Whether an image output is targeted by a context menu") });
	/** Set when the user right-clicks on JSON output or opens the ellipsis menu for a cell with JSON output. */
	export const outputJsonTargeted = new RawContextKey<boolean>('positronNotebookOutputJsonTargeted', false, { type: 'boolean', description: localize('positronNotebookOutputJsonTargeted', "Whether a JSON output is targeted by a context menu") });
}
