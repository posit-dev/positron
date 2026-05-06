/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronListInstance.css';

// React.
import { JSX, ReactNode } from 'react';

// Other dependencies.
import { Emitter, Event } from '../../../../base/common/event.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { DataGridInstance, RowSelectionState } from '../../positronDataGrid/classes/dataGridInstance.js';

/**
 * PositronListItemContext interface. Passed to the caller's itemRenderer so the rendered item
 * can display whatever it needs to for the index, selected state, and focused state.
 */
export interface PositronListItemContext {
	// The index of the item in the items array.
	readonly index: number;

	// Whether the item is currently focused (i.e. the cursor is on its row).
	readonly focused: boolean;

	// Whether the item is currently selected.
	readonly selected: boolean;
}

/**
 * PositronListItemRenderer type. The caller-provided function that renders a single list item.
 */
export type PositronListItemRenderer<T> = (item: T, context: PositronListItemContext) => ReactNode;

/**
 * PositronListInstanceOptions interface.
 */
export interface PositronListInstanceOptions<T> {
	// The initial item renderer. Can be replaced later via setItemRenderer.
	readonly itemRenderer: PositronListItemRenderer<T>;

	// The default row height. Per-row overrides can be applied via setRowHeightOverride.
	readonly defaultRowHeight: number;

	// A value which indicates whether to use the default styling.
	readonly useDefaultStyling?: boolean;
}

/**
 * PositronListInstance class.
 */
export class PositronListInstance<T> extends DataGridInstance {
	//#region Private Properties

	// Whether to apply the built-in focused/selected classes to the row wrapper.
	private readonly _useDefaultStyling: boolean;

	// The items being rendered.
	private _items: readonly T[] = [];

	// The current item renderer.
	private _itemRenderer: PositronListItemRenderer<T>;

	// Fires when the user activates an item (Enter key on a focused row).
	private readonly _onDidActivateEmitter = this._register(new Emitter<T>());

	//#endregion Private Properties

	//#region Public Events

	// Fires when the user activates an item (Enter key on a focused row).
	readonly onDidActivate: Event<T> = this._onDidActivateEmitter.event;

	//#endregion Public Events

	//#region Constructor

	/**
	 * Constructor.
	 * @param options The positron list instance options.
	 */
	constructor(options: PositronListInstanceOptions<T>) {
		// Call the base class's constructor with options shaped for a single-column list.
		super({
			columnHeaders: false,
			rowHeaders: false,
			defaultColumnWidth: 0,
			defaultRowHeight: options.defaultRowHeight,
			columnResize: false,
			rowResize: false,
			columnPinning: false,
			rowPinning: false,
			horizontalScrollbar: false,
			verticalScrollbar: true,
			scrollbarThickness: 8,
			scrollbarOverscroll: 0,
			useEditorFont: false,
			automaticLayout: true,
			cellBorders: false,
			internalCursor: true,
			cursorOffset: 0,
			selection: true,
		});

		// Default to applying the built-in focused/selected classes.
		this._useDefaultStyling = options.useDefaultStyling ?? true;

		// Set the initial item renderer.
		this._itemRenderer = options.itemRenderer;

		// Lock the column count to one.
		this._columnLayoutManager.setEntries(1);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Replaces the items rendered by the list and resets the row layout entries. Existing per-row
	 * height overrides are cleared because they reference the prior items by index and mnight
	 * otherwise stick to the wrong items after the replacement.
	 * @param items The new items.
	 */
	setItems(items: readonly T[]): void {
		// Replace the items.
		this._items = items;

		// Reset the row layout entries to match. This clears any prior size overrides.
		this._rowLayoutManager.setEntries(items.length);

		// Notify subscribers (the host PositronDataGrid) that they need to redraw.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Replaces the item renderer. Called when PositronList's itemRenderer prop changes so the
	 * caller's latest closure (and the state it captured) is used.
	 * @param itemRenderer The new item renderer.
	 */
	setItemRenderer(itemRenderer: PositronListItemRenderer<T>): void {
		// Set the new item renderer.
		this._itemRenderer = itemRenderer;

		// Notify subscribers (the host PositronDataGrid) that they need to redraw.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Sets a per-row height override.
	 * @param rowIndex The row index to override.
	 * @param rowHeight The override height in pixels.
	 */
	setRowHeightOverride(rowIndex: number, rowHeight: number): void {
		// Set the override in the row layout manager.
		this._rowLayoutManager.setSizeOverride(rowIndex, rowHeight);

		// Notify subscribers (the host PositronDataGrid) that they need to redraw.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Clears a per-row height override, reverting the row to defaultRowHeight.
	 * @param rowIndex The row index to clear.
	 */
	clearRowHeightOverride(rowIndex: number): void {
		// Clear the override in the row layout manager.
		this._rowLayoutManager.clearSizeOverride(rowIndex);

		// Notify subscribers (the host PositronDataGrid) that they need to redraw.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Returns the currently-selected items, in item-array order.
	 *
	 * DataGridInstance does not expose its selected indexes publicly, so this iterates over
	 * the items and tests each via rowSelectionState. That's O(n), which is fine for the
	 * list sizes PositronList is intended for; if a callsite ever needs huge lists we can
	 * promote this to a maintained set.
	 */
	getSelectedItems(): readonly T[] {
		const selected: T[] = [];
		for (let i = 0; i < this._items.length; i++) {
			if (this.rowSelectionState(i) !== RowSelectionState.None) {
				selected.push(this._items[i]);
			}
		}
		return selected;
	}

	//#endregion Public Methods

	//#region DataGridInstance Implementation

	/**
	 * Gets the number of columns.
	 */
	get columns(): number {
		return 1;
	}

	/**
	 * Gets the number of rows.
	 */
	get rows(): number {
		return this._items.length;
	}

	/**
	 * Gets the scroll width.
	 */
	override get scrollWidth(): number {
		return 0;
	}

	/**
	 * Gets the first column.
	 */
	override get firstColumn() {
		return {
			columnIndex: 0,
			left: 0,
			width: 0,
		};
	}

	/**
	 * Gets the custom width of a column.
	 * @param columnIndex The column index.
	 * @returns The custom width of the column; otherwise, undefined.
	 */
	override getCustomColumnWidth(columnIndex: number): number | undefined {
		// The single column always fills the available layout width.
		return columnIndex === 0 ? this.layoutWidth : undefined;
	}

	/**
	 * Gets a data cell.
	 * @param columnIndex The column index.
	 * @param rowIndex The row index.
	 * @returns The data cell, or, undefined.
	 */
	cell(columnIndex: number, rowIndex: number): JSX.Element | undefined {
		// Single-column list; reject any other column.
		if (columnIndex !== 0) {
			return undefined;
		}

		// Look up the item; bail if the index is out of range (can happen during transitions).
		const item = this._items[rowIndex];
		if (item === undefined) {
			return undefined;
		}

		// Compute the per-cell context the caller's itemRenderer expects.
		const selected = this.rowSelectionState(rowIndex) !== RowSelectionState.None;
		const focused = this.cursorRowIndex === rowIndex;

		// Wrap the caller's itemRenderer output in a positron-list-row. When useDefaultStyling is
		// on, the focused/selected classes are emitted so the built-in CSS applies; otherwise
		// the caller is responsible for rendering its own focus/selection visuals from the
		// state passed via PositronListItemContext.
		return (
			<div
				className={positronClassNames(
					'positron-list-row',
					{ 'focused': this._useDefaultStyling && focused },
					{ 'selected': this._useDefaultStyling && selected }
				)}
			>
				{this._itemRenderer(item, { index: rowIndex, selected, focused })}
			</div>
		);
	}

	/**
	 * Fires onDidActivate for the currently focused item. PositronList wraps this with its
	 * onActivate prop.
	 */
	override async onEnterKey(): Promise<void> {
		// Resolve the focused item; bail if the cursor isn't on a valid row.
		const item = this._items[this.cursorRowIndex];
		if (item === undefined) {
			return;
		}

		// Notify subscribers.
		this._onDidActivateEmitter.fire(item);
	}

	//#endregion DataGridInstance Implementation
}
