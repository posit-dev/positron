/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronList.css';

// React.
import { ReactNode, useEffect, useMemo, useRef } from 'react';

// Other dependencies.
import { PositronDataGrid } from '../positronDataGrid/positronDataGrid.js';
import { ListInstance, ListItemRenderer } from './classes/listInstance.js';

// Re-export caller-facing types so consumers don't need to reach into ./classes.
export type { ListItemContext, ListItemRenderer } from './classes/listInstance.js';

/**
 * PositronListProps interface.
 */
export interface PositronListProps<T> {
	// The items to render.
	items: readonly T[];

	// Renders a single list item. The context argument carries selection and focus state so
	// the rendered node can style itself accordingly.
	renderItem: ListItemRenderer<T>;

	// Default row height in pixels. Per-row overrides come from getRowHeight.
	defaultRowHeight: number;

	// Optional per-item row height. Return defaultRowHeight to fall back to the default.
	getRowHeight?: (item: T, index: number) => number;

	// Fires when the row selection changes. Receives the currently-selected items.
	onSelectionChange?: (selectedItems: readonly T[]) => void;

	// Fires when the user activates an item (Enter key on a focused row).
	onActivate?: (item: T) => void;

	// Optional content rendered in place of the grid when items.length === 0.
	emptyState?: ReactNode;

	// Accessibility label applied to the wrapping element.
	ariaLabel?: string;

	// Optional id for the wrapping element.
	id?: string;
}

/**
 * PositronList component. A generic, virtualized, keyboard-navigable list with multi-select
 * and variable row heights. Built on PositronDataGrid (single-column) so all of the grid's
 * keyboard, focus, and selection handling carry over for free.
 */
export function PositronList<T>(props: PositronListProps<T>) {
	// Hold the latest renderItem in a ref so the ListInstance can call through to the caller's
	// most recent closure without us having to recreate the instance on every parent render.
	const renderItemRef = useRef<ListItemRenderer<T>>(props.renderItem);
	useEffect(() => {
		renderItemRef.current = props.renderItem;
	}, [props.renderItem]);

	// Create the ListInstance once. Recreated only if defaultRowHeight changes, since
	// DataGridInstance captures defaultRowHeight in its constructor.
	const instance = useMemo(
		() => new ListInstance<T>({
			defaultRowHeight: props.defaultRowHeight,
			renderItem: (item, context) => renderItemRef.current(item, context),
		}),
		// renderItemRef is stable; defaultRowHeight is the only relevant input.
		[props.defaultRowHeight]
	);

	// Tell the instance about the latest renderItem identity so it fires an update event
	// and cells re-render with state captured by the new closure.
	useEffect(() => {
		instance.setRenderItem((item, context) => renderItemRef.current(item, context));
	}, [instance, props.renderItem]);

	// Dispose the instance when the component unmounts (or when it gets recreated).
	useEffect(() => () => instance.dispose(), [instance]);

	// Sync items and per-row height overrides into the instance.
	useEffect(() => {
		// Push the items in. setItems also resets the row layout, clearing any stale overrides.
		instance.setItems(props.items);

		// Apply per-row height overrides. We re-apply on every items/getRowHeight change
		// because setItems above wiped any prior overrides.
		if (props.getRowHeight) {
			for (let i = 0; i < props.items.length; i++) {
				const height = props.getRowHeight(props.items[i], i);
				if (height !== props.defaultRowHeight) {
					instance.setRowHeightOverride(i, height);
				}
			}
		}
	}, [instance, props.items, props.getRowHeight, props.defaultRowHeight, props]);

	// Wire up onSelectionChange to the instance's onDidUpdate event. Selection changes pass
	// through onDidUpdate alongside cursor/scroll changes, so we recompute the selected items
	// each time and let the caller diff if they care.
	useEffect(() => {
		const onSelectionChange = props.onSelectionChange;
		if (!onSelectionChange) {
			return;
		}
		const disposable = instance.onDidUpdate(() => {
			onSelectionChange(instance.getSelectedItems());
		});
		return () => disposable.dispose();
	}, [instance, props.onSelectionChange]);

	// Wire up onActivate to the instance's onDidActivate event.
	useEffect(() => {
		const onActivate = props.onActivate;
		if (!onActivate) {
			return;
		}
		const disposable = instance.onDidActivate(item => onActivate(item));
		return () => disposable.dispose();
	}, [instance, props.onActivate]);

	// Render the empty-state slot when there are no items and the caller provided one.
	if (props.items.length === 0 && props.emptyState !== undefined) {
		return (
			<div
				aria-label={props.ariaLabel}
				className='positron-list positron-list-empty'
				id={props.id}
			>
				{props.emptyState}
			</div>
		);
	}

	// Render the list as a single-column data grid.
	return (
		<div
			aria-label={props.ariaLabel}
			className='positron-list'
			id={props.id}
		>
			<PositronDataGrid instance={instance} />
		</div>
	);
}
