/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSelectorModalPopup';

// React.
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronDataGrid } from 'vs/workbench/browser/positronDataGrid/positronDataGrid';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { ColumnSearch } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/columnSearch';
import { ColumnSelectorDataGridInstance } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/columnSelectorDataGridInstance';

/**
 * ColumnSelectorModalPopupProps interface.
 */
interface ColumnSelectorModalPopupProps {
	readonly configurationService: IConfigurationService;
	readonly renderer: PositronModalReactRenderer;
	readonly columnSelectorDataGridInstance: ColumnSelectorDataGridInstance;
	readonly anchorElement: HTMLElement;
	readonly searchInput?: string;
	readonly focusInput?: boolean;
	readonly onItemSelected: (columnSchema: ColumnSchema) => void;
}

/**
 * ColumnSelectorModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ColumnSelectorModalPopup = (props: ColumnSelectorModalPopupProps) => {
	// Reference hooks.
	const positronDataGridRef = useRef<HTMLDivElement>(undefined!);

	// Main useEffect.
	useEffect(() => {
		if (props.focusInput) { return; }
		// Drive focus into the data grid so the user can immediately navigate.
		props.columnSelectorDataGridInstance.setCursorPosition(0, 0);
		positronDataGridRef.current.focus();
	}, []);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidSelectColumn event handler.
		disposableStore.add(props.columnSelectorDataGridInstance.onDidSelectColumn(columnSchema => {
			props.onItemSelected(columnSchema);
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [props, props.columnSelectorDataGridInstance]);

	const onKeyDown = (evt: React.KeyboardEvent) => {
		if (evt.code === 'Enter' || evt.code === 'Space') {
			evt.preventDefault();
			evt.stopPropagation();
			props.columnSelectorDataGridInstance.selectItem(props.columnSelectorDataGridInstance.cursorRowIndex);
		}
	};

	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchorElement={props.anchorElement}
			popupPosition='auto'
			popupAlignment='auto'
			width={props.anchorElement.offsetWidth}
			height={'min-content'}
			focusableElementSelectors='input[type="text"],div[id=column-positron-data-grid]'
			keyboardNavigationStyle='dialog'
		>
			<div className='column-selector' >
				<div className='column-selector-search'>
					<ColumnSearch
						initialSearchText={props.searchInput}
						focus={props.focusInput}
						onSearchTextChanged={async searchText => {
							await props.columnSelectorDataGridInstance.setSearchText(
								searchText !== '' ? searchText : undefined
							);
						}}
						onNavigateOut={() => {
							positronDataGridRef.current.focus();
							props.columnSelectorDataGridInstance.showCursor();
						}}
						onConfirmSearch={() => {
							props.columnSelectorDataGridInstance.selectItem(props.columnSelectorDataGridInstance.cursorColumnIndex);
						}}
					/>
				</div>
				<div
					className='column-selector-data-grid' style={{ height: 400 }}
					onKeyDown={onKeyDown}
				>
					<PositronDataGrid
						configurationService={props.configurationService}
						layoutService={props.renderer.layoutService}
						ref={positronDataGridRef}
						id='column-positron-data-grid'
						instance={props.columnSelectorDataGridInstance}
					/>
				</div>
			</div>
		</PositronModalPopup>
	);
};
