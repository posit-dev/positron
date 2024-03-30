/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowFilterBar';

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
import { RowFilter } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilter';
import { RowFilterWidget } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/rowFilterBar/components/rowFilterWidget';
import { AddEditRowFilterModalPopup } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/addEditRowFilterModalPopup';

/**
 * RowFilterBar component.
 * @returns The rendered component.
 */
export const RowFilterBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);
	const filterButtonRef = useRef<HTMLButtonElement>(undefined!);
	const addFilterButtonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [rowFilters, setRowFilters] = useState<RowFilter[]>([]);
	const [filtersHidden, setFiltersHidden] = useState(false);

	/**
	 * Shows the add / edit row filter modal popup.
	 * @param rowFilterToEdit The row filter to edit, or undefined, to add a row filter.
	 */
	const showAddEditRowFilterModalPopup = (anchor: HTMLElement, rowFilterToEdit?: RowFilter) => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			container: context.layoutService.getContainer(DOM.getWindow(ref.current))
		});

		/**
		 * onApplyRowFilter event handler.
		 * @param rowFilterToApply The row filter to apply.
		 */
		const applyRowFilterHandler = (rowFilterToApply: RowFilter) => {
			// If this is a new row filter, append it to the array of row filters. Otherwise,
			// replace the row filter that was edited.
			if (!rowFilterToEdit) {
				setRowFilters(rowFilters => [...rowFilters, rowFilterToApply]);
			} else {
				// Find the index of the row filter to edit.
				const index = rowFilters.findIndex(rowFilter =>
					rowFilterToEdit.identifier === rowFilter.identifier
				);

				setRowFilters(rowFilters =>
					[
						...rowFilters.slice(0, index),
						rowFilterToApply,
						...rowFilters.slice(index + 1)
					]
				);
			}
		};

		// Show the add /edit row filter modal popup.
		renderer.render(
			<AddEditRowFilterModalPopup
				dataExplorerClientInstance={context.instance.dataExplorerClientInstance}
				renderer={renderer}
				anchor={anchor}
				editRowFilter={rowFilterToEdit}
				onApplyRowFilter={applyRowFilterHandler}
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

	/**
	 * Clears the row filter at the specified row filter index.
	 * @param rowFilterIndex The row filter index.
	 */
	const clearRowFilter = (identifier: string) => {
		setRowFilters(rowFilters => rowFilters.filter(rowFilter =>
			identifier !== rowFilter.identifier
		));
	};

	// Render.
	return (
		<div ref={ref} className='row-filter-bar'>
			<Button
				ref={filterButtonRef}
				className='row-filter-button'
				ariaLabel={localize('positron.dataExplorer.filtering', "Filtering")}
				onPressed={filterButtonPressedHandler}
			>
				<div className='codicon codicon-positron-row-filter' />
				{rowFilters.length !== 0 && <div className='counter'>{rowFilters.length}</div>}
			</Button>
			<div className='filter-entries'>
				{!filtersHidden && rowFilters.map((rowFilter, index) =>
					<RowFilterWidget
						key={index}
						rowFilter={rowFilter}
						onEdit={() =>
							showAddEditRowFilterModalPopup(addFilterButtonRef.current, rowFilter)
						}
						onClear={() => clearRowFilter(rowFilter.identifier)} />
				)}
				<Button
					ref={addFilterButtonRef}
					className='add-row-filter-button'
					ariaLabel={localize('positron.dataExplorer.addFilter', "Add filter")}
					onPressed={() => showAddEditRowFilterModalPopup(addFilterButtonRef.current)}
				>
					<div className='codicon codicon-positron-add-filter' />
				</Button>
			</div>
		</div>
	);
};
