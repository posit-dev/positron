/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowFilterBar';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { showContextMenu } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenu';
import { ContextMenuItem } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenuItem';
import { ContextMenuSeparator } from 'vs/workbench/browser/positronComponents/contextMenu/contextMenuSeparator';
import { OKModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKModalDialog';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { RowFilterWidget } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/rowFilterBar/components/rowFilterWidget';
import { AddEditRowFilterModalPopup } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/addEditRowFilterModalPopup';
import { getRowFilterDescriptor, RowFilterDescriptor } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilterDescriptor';

/**
 * Constants.
 */
const MAX_ROW_FILTERS = 15;

/**
 * RowFilterBar component.
 * @returns The rendered component.
 */
export const RowFilterBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();
	const backendClient = context.instance.dataExplorerClientInstance;

	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);
	const rowFilterButtonRef = useRef<HTMLButtonElement>(undefined!);
	const rowFilterWidgetRefs = useRef<(HTMLButtonElement)[]>([]);
	const addFilterButtonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [rowFilterDescriptors, setRowFilterDescriptors] = useState<RowFilterDescriptor[]>(
		backendClient.cachedBackendState === undefined ? [] :
			backendClient.cachedBackendState.row_filters.map(getRowFilterDescriptor)
	);
	const [rowFiltersHidden, setRowFiltersHidden] = useState(false);

	// Main useEffect. This is where we set up event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Set up event handler for backend state sync updating the filter bar
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidUpdateBackendState(
			(state) => {
				const newDescriptors = state.row_filters.map(getRowFilterDescriptor);
				setRowFilterDescriptors(newDescriptors);
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context.instance]);

	/**
	 * Add row filter handler.
	 * @param anchor The anchor element.
	 * @param isFirstFilter Whether this is the first filter.
	 * @param editRowFilterDescriptor The row filter to edit, or undefined, to add a row filter.
	 */
	const addRowFilterHandler = (
		anchor: HTMLElement,
		isFirstFilter: boolean = false,
		editRowFilterDescriptor?: RowFilterDescriptor
	) => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			container: context.layoutService.getContainer(DOM.getWindow(ref.current))
		});

		// If a new row filter is being added, and we've reached the row filter limit, inform the
		// user that another filter cannot be added. Otherwise, show the add / edit row filter modal
		// popup.
		if (!editRowFilterDescriptor && rowFilterDescriptors.length >= MAX_ROW_FILTERS) {
			// Inform the user that another filter cannot be added.
			renderer.render(
				<OKModalDialog
					renderer={renderer}
					title={(() => localize('positron.dataExplorer.filtering.addFilter', "Add Filter"))()}
					width={350}
					height={150}
					onAccept={() => renderer.dispose()}
					onCancel={() => renderer.dispose()}
				>
					<div>{(() => localize('positron.dataExplorer.filtering.filterLimit', "The maximum number of filters has been reached."))()}</div>
				</OKModalDialog>
			);
		} else {
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
				await context.instance.tableDataDataGridInstance.setRowFilters(
					newRowFilterDescriptors.map(descr => descr.backendFilter)
				);
			};

			// Show the add /edit row filter modal popup.
			renderer.render(
				<AddEditRowFilterModalPopup
					dataExplorerClientInstance={context.instance.dataExplorerClientInstance}
					renderer={renderer}
					anchor={anchor}
					isFirstFilter={isFirstFilter}
					editRowFilter={editRowFilterDescriptor}
					onApplyRowFilter={applyRowFilterHandler}
				/>
			);
		}
	};

	/**
	 * Filter button pressed handler.
	 */
	const filterButtonPressedHandler = async () => {
		// Build the context menu entries.
		const entries: (ContextMenuItem | ContextMenuSeparator)[] = [];
		entries.push(new ContextMenuItem({
			label: localize('positron.dataExplorer.addFilter', "Add Filter"),
			icon: 'positron-add-filter',
			onSelected: () => addRowFilterHandler(
				rowFilterButtonRef.current,
				rowFilterDescriptors.length === 0
			)
		}));
		entries.push(new ContextMenuSeparator());
		if (!rowFiltersHidden) {
			entries.push(new ContextMenuItem({
				label: localize('positron.dataExplorer.hideFilters', "Hide Filters"),
				icon: 'positron-hide-filters',
				disabled: rowFilterDescriptors.length === 0,
				onSelected: () => setRowFiltersHidden(true)
			}));
		} else {
			entries.push(new ContextMenuItem({
				label: localize('positron.dataExplorer.showFilters', "Show Filters"),
				icon: 'positron-show-filters',
				onSelected: () => setRowFiltersHidden(false)
			}));
		}
		entries.push(new ContextMenuSeparator());
		entries.push(new ContextMenuItem({
			label: localize('positron.dataExplorer.clearFilters', "Clear Filters"),
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
		await context.instance.tableDataDataGridInstance.setRowFilters(
			newRowFilterDescriptors.map(descr => descr.backendFilter)
		);
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
						booleanOperator={index === 0 ? undefined : rowFilter.props.condition}
						onEdit={() => {
							if (rowFilterWidgetRefs.current[index]) {
								addRowFilterHandler(
									rowFilterWidgetRefs.current[index],
									index === 0,
									rowFilter
								);
							}
						}}
						onClear={async () => await clearRowFilter(rowFilter.identifier)} />
				)}
				<Button
					ref={addFilterButtonRef}
					className='add-row-filter-button'
					ariaLabel={(() => localize('positron.dataExplorer.addFilter', "Add Filter"))()}
					onPressed={() => addRowFilterHandler(
						addFilterButtonRef.current,
						rowFilterDescriptors.length === 0
					)}
				>
					<div className='codicon codicon-positron-add-filter' />
				</Button>
			</div>
		</div >
	);
};
