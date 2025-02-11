/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './rowFilterBar.css';

// React.
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../../nls.js';
import * as DOM from '../../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { Button } from '../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { ColumnSchema } from '../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { OKModalDialog } from '../../../../../positronComponents/positronModalDialog/positronOKModalDialog.js';
import { usePositronDataExplorerContext } from '../../../../positronDataExplorerContext.js';
import { PositronModalReactRenderer } from '../../../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { CustomContextMenuItem } from '../../../../../positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../../positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../../positronComponents/customContextMenu/customContextMenu.js';
import { RowFilterWidget } from './components/rowFilterWidget.js';
import { AddEditRowFilterModalPopup } from '../addEditRowFilterModalPopup/addEditRowFilterModalPopup.js';
import { getRowFilterDescriptor, RowFilterDescriptor } from '../addEditRowFilterModalPopup/rowFilterDescriptor.js';
import { dataExplorerExperimentalFeatureEnabled } from '../../../../../../services/positronDataExplorer/common/positronDataExplorerExperimentalConfig.js';

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

	/**
	 * Add row filter handler.
	 * @param anchorElement The anchor element.
	 * @param isFirstFilter Whether this is the first filter.
	 * @param schema The column schema to preselect.
	 * @param editRowFilterDescriptor The row filter to edit, or undefined, to add a row filter.
	 */
	const addRowFilterHandler = useCallback((
		anchorElement: HTMLElement,
		isFirstFilter: boolean,
		schema?: ColumnSchema,
		editRowFilterDescriptor?: RowFilterDescriptor,
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
					height={150}
					renderer={renderer}
					title={(() => localize('positron.dataExplorer.filtering.addFilter', "Add Filter"))()}
					width={350}
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
					anchorElement={anchorElement}
					configurationService={context.configurationService}
					dataExplorerClientInstance={context.instance.dataExplorerClientInstance}
					editRowFilter={editRowFilterDescriptor}
					isFirstFilter={isFirstFilter}
					renderer={renderer}
					schema={schema}
					onApplyRowFilter={applyRowFilterHandler}
				/>
			);
		}
	}, [
		context.configurationService,
		context.instance.dataExplorerClientInstance,
		context.instance.tableDataDataGridInstance,
		context.keybindingService,
		context.layoutService,
		rowFilterDescriptors
	]);

	const features = backendClient.getSupportedFeatures();
	const canFilter = dataExplorerExperimentalFeatureEnabled(features.set_row_filters.support_status, context.configurationService);

	/**
	 * Filter button pressed handler.
	 */
	const filterButtonPressedHandler = async () => {
		// Build the context menu entries.
		const entries: CustomContextMenuEntry[] = [];
		entries.push(new CustomContextMenuItem({
			icon: 'positron-add-filter',
			label: localize('positron.dataExplorer.addFilter', "Add Filter"),
			disabled: !canFilter,
			onSelected: () => addRowFilterHandler(
				rowFilterButtonRef.current,
				rowFilterDescriptors.length === 0
			)
		}));
		entries.push(new CustomContextMenuSeparator());
		if (!rowFiltersHidden) {
			entries.push(new CustomContextMenuItem({
				icon: 'positron-hide-filters',
				label: localize('positron.dataExplorer.hideFilters', "Hide Filters"),
				disabled: rowFilterDescriptors.length === 0,
				onSelected: () => setRowFiltersHidden(true)
			}));
		} else {
			entries.push(new CustomContextMenuItem({
				icon: 'positron-show-filters',
				label: localize('positron.dataExplorer.showFilters', "Show Filters"),
				onSelected: () => setRowFiltersHidden(false)
			}));
		}
		entries.push(new CustomContextMenuSeparator());
		entries.push(new CustomContextMenuItem({
			icon: 'positron-clear-row-filters',
			label: localize('positron.dataExplorer.clearFilters', "Clear Filters"),
			disabled: rowFilterDescriptors.length === 0,
			onSelected: async () => {
				// Clear the row filter descriptors.
				setRowFilterDescriptors([]);

				// Clear the row filters.
				await context.instance.tableDataDataGridInstance.setRowFilters([]);
			}
		}));

		// Show the context menu.
		await showCustomContextMenu({
			commandService: context.commandService,
			keybindingService: context.keybindingService,
			layoutService: context.layoutService,
			anchorElement: rowFilterButtonRef.current,
			popupPosition: 'auto',
			popupAlignment: 'left',
			width: 200,
			entries
		});
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

	// Main useEffect. This is where we set up event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onAddFilter event handler.
		disposableStore.add(context.instance.tableDataDataGridInstance.onAddFilter(schema => {
			addRowFilterHandler(
				addFilterButtonRef.current,
				rowFilterDescriptors.length === 0,
				schema
			);
		}));

		// Add the onDidUpdateBackendState event handler.
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidUpdateBackendState(
			state => {
				const newDescriptors = state.row_filters.map(getRowFilterDescriptor);
				setRowFilterDescriptors(newDescriptors);
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [addRowFilterHandler, context.instance, rowFilterDescriptors.length]);

	// Render.
	return (
		<div ref={ref} className='row-filter-bar'>
			<Button
				ref={rowFilterButtonRef}
				ariaLabel={(() => localize('positron.dataExplorer.filtering', "Filtering"))()}
				className='row-filter-button'
				onPressed={filterButtonPressedHandler}
			>
				<div className='codicon codicon-positron-row-filter' />
				{rowFilterDescriptors.length !== 0 && <div className='counter'>{rowFilterDescriptors.length}</div>}
			</Button>
			<div className='filter-entries'>
				{!rowFiltersHidden && rowFilterDescriptors.map((rowFilter, index) =>
					<RowFilterWidget
						key={index}
						ref={ref => {
							if (ref) {
								rowFilterWidgetRefs.current[index] = ref;
							}
						}}
						booleanOperator={index === 0 ? undefined : rowFilter.props.condition}
						rowFilter={rowFilter}
						onClear={async () => await clearRowFilter(rowFilter.identifier)}
						onEdit={() => {
							if (rowFilterWidgetRefs.current[index]) {
								addRowFilterHandler(
									rowFilterWidgetRefs.current[index],
									index === 0,
									rowFilter.schema,
									rowFilter
								);
							}
						}} />
				)}
				<Button
					ref={addFilterButtonRef}
					ariaLabel={(() => localize('positron.dataExplorer.addFilter', "Add Filter"))()}
					className='add-row-filter-button'
					disabled={!canFilter}
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
