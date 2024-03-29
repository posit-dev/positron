/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./filterBar';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { showContextMenu } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenu';
import { ContextMenuItem } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenuItem';
import { ContextMenuSeparator } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenuSeparator';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { AddEditRowFilterModalPopup } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/addEditRowFilterModalPopup';
import { RowFilter, RowFilterIsBetween, RowFilterIsEmpty, RowFilterIsEqualTo, RowFilterIsGreaterThan, RowFilterIsLessThan, RowFilterIsNotBetween, RowFilterIsNotEmpty } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilter';

// Temporary filter.
interface Filter {
	name: string;
	width: number;
}

/**
 * FilterBar component.
 * @returns The rendered component.
 */
export const FilterBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);
	const filterButtonRef = useRef<HTMLButtonElement>(undefined!);
	const addFilterButtonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [rowFilters, setRowFilters] = useState<Filter[]>([]);
	const [filtersHidden, setFiltersHidden] = useState(false);

	/**
	 * Shows the add / edit row filter modal popup.
	 * @param rowFilter The row filter to edit, or undefined, to add a row filter.
	 */
	const showAddEditRowFilterModalPopup = (anchor: HTMLElement, rowFilter?: RowFilter) => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			container: context.layoutService.getContainer(DOM.getWindow(ref.current))
		});

		/**
		 * onAddRowFilter event handler.
		 * @param rowFilter The row filter.
		 */
		const addRowFilterHandler = (rowFilter: RowFilter) => {
			if (rowFilter instanceof RowFilterIsEmpty) {
				console.log(`is empty row filter for ${rowFilter.columnSchema.column_name}`);
			} else if (rowFilter instanceof RowFilterIsNotEmpty) {
				console.log(`is not empty row filter for ${rowFilter.columnSchema.column_name}`);
			} else if (rowFilter instanceof RowFilterIsLessThan) {
				console.log(`is less than ${rowFilter.value} row filter for ${rowFilter.columnSchema.column_name}`);
			} else if (rowFilter instanceof RowFilterIsGreaterThan) {
				console.log(`is greater than ${rowFilter.value} row filter for ${rowFilter.columnSchema.column_name}`);
			} else if (rowFilter instanceof RowFilterIsEqualTo) {
				console.log(`is equal to ${rowFilter.value} row filter for ${rowFilter.columnSchema.column_name}`);
			} else if (rowFilter instanceof RowFilterIsBetween) {
				console.log(`is between ${rowFilter.lowerLimit} ${rowFilter.upperLimit} row filter for ${rowFilter.columnSchema.column_name}`);
			} else if (rowFilter instanceof RowFilterIsNotBetween) {
				console.log(`is not between ${rowFilter.lowerLimit} ${rowFilter.upperLimit} row filter for ${rowFilter.columnSchema.column_name}`);
			}
		};

		// Show the add /edit row filter modal popup.
		renderer.render(
			<AddEditRowFilterModalPopup
				dataExplorerClientInstance={context.instance.dataExplorerClientInstance}
				renderer={renderer}
				anchor={anchor}
				rowFilter={rowFilter}
				onAddRowFilter={addRowFilterHandler}
			/>
		);
	};

	/**
	 * Filter button pressed handler.
	 */
	const filterButtonPressedHandler = async () => {
		// Build the context menu entries.
		const entries: (ContextMenuItem | ContextMenuSeparator)[] = [];
		entries.push(new ContextMenuItem({
			label: localize('positron.dataExplorer.addFilter', "Add filter"),
			icon: 'positron-add-filter',
			onSelected: () => showAddEditRowFilterModalPopup(filterButtonRef.current)
		}));
		entries.push(new ContextMenuSeparator());
		if (!filtersHidden) {
			entries.push(new ContextMenuItem({
				label: localize('positron.dataExplorer.hideFilters', "Hide filters"),
				icon: 'positron-hide-filters',
				disabled: rowFilters.length === 0,
				onSelected: () => setFiltersHidden(true)
			}));
		} else {
			entries.push(new ContextMenuItem({
				label: localize('positron.dataExplorer.showFilters', "Show filters"),
				icon: 'positron-show-filters',
				onSelected: () => setFiltersHidden(false)
			}));
		}
		entries.push(new ContextMenuSeparator());
		entries.push(new ContextMenuItem({
			label: localize('positron.dataExplorer.clearFilters', "Clear filters"),
			icon: 'positron-clear-row-filters',
			disabled: rowFilters.length === 0,
			onSelected: () => setRowFilters([])
		}));

		// Show the context menu.
		await showContextMenu(
			context.keybindingService,
			context.layoutService,
			filterButtonRef.current,
			'left',
			200,
			entries
		);
	};

	// Render.
	return (
		<div ref={ref} className='filter-bar'>
			<div className='filter'>
				<Button
					ref={filterButtonRef}
					className='filter-button'
					ariaLabel={localize('positron.dataExplorer.filtering', "Filtering")}
					onPressed={filterButtonPressedHandler}
				>
					<div className='codicon codicon-positron-row-filter' />
					{rowFilters.length !== 0 && <div className='counter'>{rowFilters.length}</div>}
				</Button>
			</div>
			<div className='filter-entries'>
				{!filtersHidden && rowFilters.map((filter, index) =>
					<div
						key={index}
						className='filter'
						style={{ width: filter.width }}
					>
						{filter.name}
					</div>
				)}
				<Button
					ref={addFilterButtonRef}
					className='add-filter-button'
					ariaLabel={localize('positron.dataExplorer.addFilter', "Add filter")}
					onPressed={() => showAddEditRowFilterModalPopup(addFilterButtonRef.current)}
				>
					<div className='codicon codicon-positron-add-filter' />
				</Button>
			</div>
		</div>
	);
};
