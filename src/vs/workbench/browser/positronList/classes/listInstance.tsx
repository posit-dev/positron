/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { JSX, ReactNode } from 'react';

// Other dependencies.
import { Emitter, Event } from '../../../../base/common/event.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { DataGridInstance, RowSelectionState } from '../../positronDataGrid/classes/dataGridInstance.js';

/**
 * ListItemContext interface. Passed to the caller's renderItem callback so the rendered
 * item can react to selection and focus state.
 */
export interface ListItemContext {
	// The index of the item in the items array.
	readonly index: number;

	// Whether the item is currently selected.
	readonly selected: boolean;

	// Whether the item currently holds the keyboard focus (cursor row).
	readonly focused: boolean;
}

/**
 * ListItemRenderer type. The caller-provided function that renders a single list item.
 */
export type ListItemRenderer<T> = (item: T, context: ListItemContext) => ReactNode;

/**
 * ListInstanceOptions interface.
 */
export interface ListInstanceOptions<T> {
	// The default row height. Per-row overrides can be applied via setRowHeightOverride.
	readonly defaultRowHeight: number;

	// The initial item renderer. Can be replaced later via setRenderItem.
	readonly renderItem: ListItemRenderer<T>;
}

/**
 * ListInstance class.
 *
 * A DataGridInstance specialized as a single-column list. Backs PositronList; not intended
 * to be subclassed by feature code. Keyboard navigation, focus, virtualization, and
 * multi-select all come from DataGridInstance.
 */
export class ListInstance<T> extends DataGridInstance {
	//#region Private Properties

	// The items being rendered.
	private _items: readonly T[] = [];

	// The current item renderer.
	private _renderItem: ListItemRenderer<T>;

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
	 * @param options The list instance options.
	 */
	constructor(options: ListInstanceOptions<T>) {
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

		// Stash the initial renderer.
		this._renderItem = options.renderItem;

		// Lock the column count to one.
		this._columnLayoutManager.setEntries(1);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Replaces the items rendered by the list and resets the row layout entries.
	 * Existing per-row height overrides are cleared because they reference the prior items
	 * by index and would otherwise stick to the wrong items after the replacement.
	 * @param items The new items.
	 */
	setItems(items: readonly T[]): void {
		// Replace the items.
		this._items = items;

		// Reset the row layout entries to match. setEntries clears any prior size overrides
		// because they were keyed by index against the old items.
		this._rowLayoutManager.setEntries(items.length);

		// Notify subscribers (the host PositronDataGrid) that they need to redraw.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Replaces the item renderer. Called when PositronList's renderItem prop changes so
	 * the caller's latest closure (and the state it captured) is used.
	 * @param renderItem The new item renderer.
	 */
	setRenderItem(renderItem: ListItemRenderer<T>): void {
		// Swap the renderer and trigger a redraw so cells re-render with the new closure.
		this._renderItem = renderItem;
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Sets a per-row height override. Bypasses the public setRowHeight (which is gated on
	 * rowResize: true) by talking to the layout manager directly, the same trick
	 * TableSummaryDataGridInstance uses for expand/collapse.
	 * @param rowIndex The row index to override.
	 * @param rowHeight The override height in pixels.
	 */
	setRowHeightOverride(rowIndex: number, rowHeight: number): void {
		this._rowLayoutManager.setSizeOverride(rowIndex, rowHeight);
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Clears a per-row height override, reverting the row to defaultRowHeight.
	 * @param rowIndex The row index to clear.
	 */
	clearRowHeightOverride(rowIndex: number): void {
		this._rowLayoutManager.clearSizeOverride(rowIndex);
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

	get columns(): number {
		return 1;
	}

	get rows(): number {
		return this._items.length;
	}

	override get scrollWidth(): number {
		return 0;
	}

	override get firstColumn() {
		return {
			columnIndex: 0,
			left: 0,
			width: 0,
		};
	}

	override async fetchData(): Promise<void> {
		// PositronList holds its items in memory; nothing to fetch.
	}

	override getCustomColumnWidth(columnIndex: number): number | undefined {
		// The single column always fills the available layout width.
		return columnIndex === 0 ? this.layoutWidth : undefined;
	}

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

		// Compute the per-cell context the caller's renderItem expects.
		const selected = this.rowSelectionState(rowIndex) !== RowSelectionState.None;
		const focused = this.cursorRowIndex === rowIndex;

		// Wrap the caller's renderItem output in a positron-list-row so default focus and
		// selection styling applies without every consumer needing their own CSS.
		return (
			<div
				className={positronClassNames(
					'positron-list-row',
					{ 'focused': focused },
					{ 'selected': selected }
				)}
			>
				{this._renderItem(item, { index: rowIndex, selected, focused })}
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
