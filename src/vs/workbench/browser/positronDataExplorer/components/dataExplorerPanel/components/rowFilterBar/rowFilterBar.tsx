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
import { RowFilter, RowFilterCondition, RowFilterType } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { RowFilterWidget } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/rowFilterBar/components/rowFilterWidget';
import { AddEditRowFilterModalPopup } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/addEditRowFilterModalPopup';
import {
	RowFilterDescriptor,
	RowFilterDescriptorComparison,
	RowFilterDescriptorIsEmpty,
	RowFilterDescriptorIsNotEmpty,
	RowFilterDescriptorIsNull,
	RowFilterDescriptorIsNotNull,
	RowFilterDescriptorIsBetween,
	RowFilterDescriptorIsNotBetween,
	RowFilterDescriptorSearch
} from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilterDescriptor';

/**
 * Creates row filters from row filter descriptors.
 * @param rowFilterDescriptors The row filter descriptors.
 * @returns The row filters.
 */
const createRowFilters = (rowFilterDescriptors: RowFilterDescriptor[]) => {
	// Create the set of row filters.
	return rowFilterDescriptors.reduce<RowFilter[]>((
		rowFilters,
		rowFilterDescriptor
	) => {
		//
		const sharedParams = {
			filter_id: rowFilterDescriptor.identifier,
			column_index: rowFilterDescriptor.columnSchema.column_index,
			condition: RowFilterCondition.And
		};

		if (rowFilterDescriptor instanceof RowFilterDescriptorIsEmpty) {
			rowFilters.push({
				filter_type: RowFilterType.IsEmpty,
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorIsNotEmpty) {
			rowFilters.push({
				filter_type: RowFilterType.NotEmpty,
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorIsNull) {
			rowFilters.push({
				filter_type: RowFilterType.IsNull,
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorIsNotNull) {
			rowFilters.push({
				filter_type: RowFilterType.NotNull,
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorComparison) {
			rowFilters.push({
				filter_type: RowFilterType.Compare,
				compare_params: {
					op: rowFilterDescriptor.compareFilterOp,
					value: rowFilterDescriptor.value
				},
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorSearch) {
			rowFilters.push({
				filter_type: RowFilterType.Search,
				search_params: {
					search_type: rowFilterDescriptor.searchOp,
					term: rowFilterDescriptor.value,
					case_sensitive: false
				},
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorIsBetween) {
			rowFilters.push({
				filter_type: RowFilterType.Between,
				between_params: {
					left_value: rowFilterDescriptor.lowerLimit,
					right_value: rowFilterDescriptor.upperLimit
				},
				...sharedParams
			});
		} else if (rowFilterDescriptor instanceof RowFilterDescriptorIsNotBetween) {
			rowFilters.push({
				filter_type: RowFilterType.NotBetween,
				between_params: {
					left_value: rowFilterDescriptor.lowerLimit,
					right_value: rowFilterDescriptor.upperLimit
				},
				...sharedParams
			});
		}

		// Return the row filters.
		return rowFilters;
	}, []);
};


/**
 * RowFilterBar component.
 * @returns The rendered component.
 */
export const RowFilterBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);
	const rowFilterButtonRef = useRef<HTMLButtonElement>(undefined!);
	const rowFilterWidgetRefs = useRef<(HTMLButtonElement)[]>([]);
	const addFilterButtonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [rowFilterDescriptors, setRowFilterDescriptors] = useState<RowFilterDescriptor[]>([]);
	const [rowFiltersHidden, setRowFiltersHidden] = useState(false);

	/**
	 * Shows the add / edit row filter modal popup.
	 * @param editRowFilterDescriptor The row filter to edit, or undefined, to add a row filter.
	 */
	const showAddEditRowFilterModalPopup = (
		anchor: HTMLElement,
		editRowFilterDescriptor?: RowFilterDescriptor
	) => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			container: context.layoutService.getContainer(DOM.getWindow(ref.current))
		});

		/**
		 * onApplyRowFilter event handler.
		 * @param applyRowFilterDescriptor The row filter descriptor to apply.
		 */
		const applyRowFilterHandler = async (applyRowFilterDescriptor: RowFilterDescriptor) => {
			// Create the new row filter descriptors. If this is a new row filter, append it;
			// otherwise, replace the row filter that was edited.
			let newRowFilterDescriptors: RowFilterDescriptor[];
			if (!editRowFilterDescriptor) {
				// Update the row filters.
				newRowFilterDescriptors = [...rowFilterDescriptors, applyRowFilterDescriptor];
			} else {
				// Find the index of the row filter.
				const index = rowFilterDescriptors.findIndex(rowFilter =>
					editRowFilterDescriptor.identifier === rowFilter.identifier
				);

				// Update the row filters.
				newRowFilterDescriptors = [
					...rowFilterDescriptors.slice(0, index),
					applyRowFilterDescriptor,
					...rowFilterDescriptors.slice(index + 1)
				];
			}

			// Set the new row filter descriptors.
			setRowFilterDescriptors(newRowFilterDescriptors);

			// Set the new row filters.
			await context.instance.tableDataDataGridInstance.setRowFilters(createRowFilters(
				newRowFilterDescriptors
			));
		};

		// Show the add /edit row filter modal popup.
		renderer.render(
			<AddEditRowFilterModalPopup
				dataExplorerClientInstance={context.instance.dataExplorerClientInstance}
				renderer={renderer}
				anchor={anchor}
				editRowFilter={editRowFilterDescriptor}
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
			onSelected: () => showAddEditRowFilterModalPopup(rowFilterButtonRef.current)
		}));
		entries.push(new ContextMenuSeparator());
		if (!rowFiltersHidden) {
			entries.push(new ContextMenuItem({
				label: localize('positron.dataExplorer.hideFilters', "Hide filters"),
				icon: 'positron-hide-filters',
				disabled: rowFilterDescriptors.length === 0,
				onSelected: () => setRowFiltersHidden(true)
			}));
		} else {
			entries.push(new ContextMenuItem({
				label: localize('positron.dataExplorer.showFilters', "Show filters"),
				icon: 'positron-show-filters',
				onSelected: () => setRowFiltersHidden(false)
			}));
		}
		entries.push(new ContextMenuSeparator());
		entries.push(new ContextMenuItem({
			label: localize('positron.dataExplorer.clearFilters', "Clear filters"),
			icon: 'positron-clear-row-filters',
			disabled: rowFilterDescriptors.length === 0,
			onSelected: async () => {
				// Clear the row filter descriptors.
				setRowFilterDescriptors([]);

				// Clear the row filters.
				await context.instance.tableDataDataGridInstance.setRowFilters([]);
			}
		}));

		// Show the context menu.
		await showContextMenu(
			context.keybindingService,
			context.layoutService,
			rowFilterButtonRef.current,
			'left',
			200,
			entries
		);
	};

	/**
	 * Clears the row filter at the specified row filter index.
	 * @param rowFilterIndex The row filter index.
	 */
	const clearRowFilter = async (identifier: string): Promise<void> => {
		// Remove the row filter.
		const newRowFilterDescriptors = rowFilterDescriptors.filter(rowFilter =>
			identifier !== rowFilter.identifier
		);

		// Set the new row filter descriptors.
		setRowFilterDescriptors(newRowFilterDescriptors);

		// Set the new row filters.
		await context.instance.tableDataDataGridInstance.setRowFilters(createRowFilters(
			newRowFilterDescriptors
		));
	};

	// Render.
	return (
		<div ref={ref} className='row-filter-bar'>
			<Button
				ref={rowFilterButtonRef}
				className='row-filter-button'
				ariaLabel={(() => localize('positron.dataExplorer.filtering', "Filtering"))()}
				onPressed={filterButtonPressedHandler}
			>
				<div className='codicon codicon-positron-row-filter' />
				{rowFilterDescriptors.length !== 0 && <div className='counter'>{rowFilterDescriptors.length}</div>}
			</Button>
			<div className='filter-entries'>
				{!rowFiltersHidden && rowFilterDescriptors.map((rowFilter, index) =>
					<RowFilterWidget
						ref={ref => {
							if (ref) {
								rowFilterWidgetRefs.current[index] = ref;
							}
						}}
						key={index}
						rowFilter={rowFilter}
						booleanOperator={index ? 'and' : undefined}
						onEdit={() => {
							if (rowFilterWidgetRefs.current[index]) {
								showAddEditRowFilterModalPopup(
									rowFilterWidgetRefs.current[index],
									rowFilter
								);
							}
						}}
						onClear={async () => await clearRowFilter(rowFilter.identifier)} />
				)}
				<Button
					ref={addFilterButtonRef}
					className='add-row-filter-button'
					ariaLabel={(() => localize('positron.dataExplorer.addFilter', "Add filter"))()}
					onPressed={() => showAddEditRowFilterModalPopup(addFilterButtonRef.current)}
				>
					<div className='codicon codicon-positron-add-filter' />
				</Button>
			</div>
		</div>
	);
};
