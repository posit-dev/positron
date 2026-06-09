/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronListInstance.css';

// React.
import { JSX, ReactNode } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { DataGridInstance, MouseSelectionType, RowSelectionState, SelectionCursorOptions, selectionCursorOptions } from '../../positronDataGrid/classes/dataGridInstance.js';

/**
 * PositronListItemContext interface. Passed to the caller's itemRenderer so the rendered item
 * can display whatever it needs to.
 */
export interface PositronListItemContext {
	// The index of the entry in the entries array.
	readonly index: number;

	// Whether the cursor is on this row. Combine with listFocused to render a "focused" indicator
	// only when the list itself has keyboard focus.
	readonly cursor: boolean;

	// Whether the list has keyboard focus.
	readonly listFocused: boolean;

	// Whether the item is currently selected.
	readonly selected: boolean;
}

/**
 * PositronListSectionContext interface. Passed to the caller's sectionRenderer so the rendered
 * item can display whatever it needs to.
 */
export interface PositronListSectionContext {
	// The index of the entry in the entries array.
	readonly index: number;
}

/**
 * PositronListItemRenderer type. The caller-provided function that renders a single list item.
 */
export type PositronListItemRenderer<TItem> = (item: TItem, context: PositronListItemContext) => ReactNode;

/**
 * PositronListSectionRenderer type. The caller-provided function that renders a single section
 * row. Optional -- lists without sections don't supply one.
 */
export type PositronListSectionRenderer<TSection> = (section: TSection, context: PositronListSectionContext) => ReactNode;

/**
 * ListEntry type. A discriminated union describing one row in the list -- either a section
 * row or an item. Callers pass an array of these to setEntries; the order is the visible order.
 *
 * The TSection generic defaults to never on PositronListInstance, so a list without a
 * sectionRenderer cannot construct section entries -- the type system makes "this list has
 * sections" an explicit choice rather than something the caller could accidentally do.
 */
export type ListEntry<TItem, TSection> =
	| { readonly kind: 'item'; readonly item: TItem }
	| { readonly kind: 'section'; readonly section: TSection };

/**
 * PositronListSelectionMode type. Multiple- or single-selection mode for the list.
 */
export type PositronListSelectionMode = 'list-multiple-selection' | 'list-single-selection';

/**
 * PositronListBaseOptions type. Options common to both sectioned and non-sectioned lists.
 */
type PositronListBaseOptions = {
	// A value which indicates whether to use the default styling.
	readonly useDefaultStyling?: boolean;

	// Multiple- or single-selection mode. Defaults to 'list-single-selection'.
	readonly selectionMode?: PositronListSelectionMode;
};

/**
 * PositronListItemOptions type. Item configuration is separate since every list needs an itemRenderer
 * but not every list needs a sectionRenderer.
 */
type PositronListItemOptions<TItem> = {
	// The item renderer.
	readonly itemRenderer: PositronListItemRenderer<TItem>;

	// The item row height.
	readonly itemHeight: number;
};

/**
 * PositronListSectionOptions type. Couples the section options to TSection: when TSection is never
 * (the default), the section options must be absent; when TSection is anything else, sectionRenderer
 * and sectionHeight are both required. The [TSection] extends [never] idiom (with brackets) prevents
 * TypeScript from distributing the conditional over union arms, which is the standard way to test
 * whether a type parameter is exactly never.
 */
type PositronListSectionOptions<TSection> = [TSection] extends [never]
	? {
		// No section renderer.
		readonly sectionRenderer?: undefined;

		// No section height, since section entries aren't allowed without a renderer.
		readonly sectionHeight?: undefined;
	}
	: {
		// The section renderer.
		readonly sectionRenderer: PositronListSectionRenderer<TSection>;

		// The section row height.
		readonly sectionHeight: number;
	};

/**
 * PositronListInstanceOptions type.
 */
export type PositronListInstanceOptions<TItem, TSection> =
	& PositronListBaseOptions
	& PositronListItemOptions<TItem>
	& PositronListSectionOptions<TSection>
	& SelectionCursorOptions;

/**
 * PositronListInstance class.
 */
export class PositronListInstance<TItem, TSection = never> extends DataGridInstance {
	//#region Private Properties

	// Whether to apply the built-in focused/selected classes to the item row wrapper. Sections
	// are never focused/selected regardless of this flag.
	private readonly _useDefaultStyling: boolean;

	// The section row height. Undefined when no sectionRenderer was supplied, in which case
	// section entries can't exist (the discriminated-pair options type enforces this) and the
	// field is never read.
	private readonly _sectionHeight: number | undefined;

	// The entries being rendered. Sections and items are interleaved; row index is the position
	// in this array.
	private _entries: readonly ListEntry<TItem, TSection>[] = [];

	// The current item renderer.
	private _itemRenderer: PositronListItemRenderer<TItem>;

	// The current section renderer, if any.
	private _sectionRenderer?: PositronListSectionRenderer<TSection>;

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param options The positron list instance options.
	 */
	constructor(options: PositronListInstanceOptions<TItem, TSection>) {
		// Call the base class's constructor with options shaped for a single-column list.
		super({
			columnHeaders: false,
			rowHeaders: false,
			defaultColumnWidth: 0,
			defaultRowHeight: options.itemHeight,
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
			internalCursor: false,
			selection: true,
			selectionMode: options.selectionMode ?? 'list-single-selection',
			...selectionCursorOptions(options),
		});

		// Default to applying the built-in focused/selected classes.
		this._useDefaultStyling = options.useDefaultStyling ?? true;

		// Store the section height. The item height is passed to the base class as the default row
		// height (above).
		this._sectionHeight = options.sectionHeight;

		// Store the item configuration. All lists have items.
		this._itemRenderer = options.itemRenderer;

		// Store the section configuration. Not all lists have sections.
		this._sectionRenderer = options.sectionRenderer;

		// Lock the column count to one.
		this._columnLayoutManager.setEntries(1);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Replaces the entries rendered by the list. Item rows use the configured item height; section
	 * rows use the configured section height, applied as sparse layout size overrides so the layout
	 * stays fast even for very large lists.
	 * @param entries The new entries.
	 */
	setEntries(entries: readonly ListEntry<TItem, TSection>[]): void {
		// Clear the size overrides registered for the previous entries' section rows.
		this._rowLayoutManager.clearSizeOverrides();

		// Set the entries.
		this._entries = entries;

		// Reset the row layout entries. Item rows all use itemHeight, which is the layout manager's
		// default row height, so no per-row sizes are supplied -- the layout manager stays on its
		// O(1) default-size fast path regardless of how many items there are. Only section rows
		// differ, and they're registered as sparse size overrides below.
		this._rowLayoutManager.setEntries(entries.length);

		// Register a size override for each section row. Sections are sparse relative to items, so
		// the override map stays small and the layout hot paths (which iterate it) stay fast.
		// _sectionHeight is guaranteed defined whenever a section entry exists, since the
		// discriminated-pair options type pairs sectionRenderer with sectionHeight.
		if (this._sectionHeight !== undefined) {
			for (let rowIndex = 0; rowIndex < entries.length; rowIndex++) {
				if (entries[rowIndex].kind === 'section') {
					this._rowLayoutManager.setSizeOverride(rowIndex, this._sectionHeight);
				}
			}
		}

		// If the cursor landed on a section (typical on first render when the first entry is a
		// section header), advance it to the next selectable item row.
		if (!this.isRowSelectable(this.cursorRowIndex)) {
			for (let rowIndex = this.cursorRowIndex + 1; rowIndex < this._entries.length; rowIndex++) {
				if (this.isRowSelectable(rowIndex)) {
					this.setCursorRow(rowIndex);
					break;
				}
			}
		}

		// Notify subscribers (the host PositronDataGrid) that they need to redraw.
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Replaces the item renderer. Called when PositronList's itemRenderer prop changes so the
	 * caller's latest closure (and the state it captured) is used.
	 * @param itemRenderer The new item renderer.
	 */
	setItemRenderer(itemRenderer: PositronListItemRenderer<TItem>): void {
		this._itemRenderer = itemRenderer;
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Replaces the section renderer. Called when PositronList's sectionRenderer prop changes so
	 * the caller's latest closure is used. Pass undefined to clear it.
	 * @param sectionRenderer The new section renderer, or undefined.
	 */
	setSectionRenderer(sectionRenderer: PositronListSectionRenderer<TSection> | undefined): void {
		this._sectionRenderer = sectionRenderer;
		this.fireOnDidUpdateEvent();
	}

	/**
	 * Returns the currently-selected items, in entry order. Section rows are skipped even if
	 * a range selection happens to span across them.
	 *
	 * DataGridInstance does not expose its selected indexes publicly, so this iterates over
	 * the entries and tests each via rowSelectionState. That's O(n), which is fine for the
	 * list sizes PositronList is intended for; if a callsite ever needs huge lists we can
	 * promote this to a maintained set.
	 */
	getSelectedItems(): readonly TItem[] {
		const selected: TItem[] = [];
		for (let i = 0; i < this._entries.length; i++) {
			const entry = this._entries[i];
			if (entry.kind === 'item' && this.rowSelectionState(i) !== RowSelectionState.None) {
				selected.push(entry.item);
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
		return this._entries.length;
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

		// Look up the entry; bail if the index is out of range (can happen during transitions).
		const entry = this._entries[rowIndex];
		if (entry === undefined) {
			return undefined;
		}

		// Render item rows. Wrap the caller's itemRenderer output in a positron-list-row. When
		// useDefaultStyling is on, the focused/selected classes are emitted so the built-in CSS
		// applies; otherwise the caller is responsible for rendering its own focus/selection
		// visuals from the state passed via PositronListItemContext. The .focused class only
		// applies when the cursor is on this row AND the list itself has keyboard focus, so the
		// focus ring disappears when focus leaves the list.
		if (entry.kind === 'item') {
			const selected = this.rowSelectionState(rowIndex) !== RowSelectionState.None;
			const cursor = this.cursorRowIndex === rowIndex;
			const listFocused = this.focused;
			return (
				<div
					className={positronClassNames(
						'positron-list-row',
						{ 'focused': this._useDefaultStyling && cursor && listFocused },
						{ 'selected': this._useDefaultStyling && selected }
					)}
				>
					{this._itemRenderer(entry.item, { index: rowIndex, cursor, listFocused, selected })}
				</div>
			);
		}

		// Render section rows in their own wrapper. (The bulletproof options type guarantees a
		// sectionRenderer exists whenever a section entry can.)
		return (
			<div className='positron-list-section'>
				{this._sectionRenderer?.(entry.section, { index: rowIndex })}
			</div>
		);
	}

	/**
	 * Marks section rows as not selectable, so DataGridInstance keyboard navigation skips them
	 * and clicks on them are ignored.
	 */
	override isRowSelectable(rowIndex: number): boolean {
		return this._entries[rowIndex]?.kind === 'item';
	}

	/**
	 * Redirects cell-level mouse selection to row-level selection. PositronList is a single-column
	 * row list, so clicks should populate the row selection bucket (which the row wrapper's
	 * `.selected` class and `getSelectedItems()` read) rather than the cell selection bucket.
	 */
	override async mouseSelectCell(
		_columnIndex: number,
		rowIndex: number,
		_pinned: boolean,
		mouseSelectionType: MouseSelectionType
	): Promise<void> {
		await this.mouseSelectRow(rowIndex, mouseSelectionType);
	}

	//#endregion DataGridInstance Implementation
}
