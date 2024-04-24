/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBar';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { usePositronDataExplorerContext } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { LayoutMenuButton } from 'vs/workbench/browser/positronDataExplorer/components/actionBar/components/layoutMenuButton';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { DataExplorerClientStatus } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * Localized strings.
 */
const clearSortButtonTitle = localize('positron.clearSortButtonLabel', "Clear Sorting");
const clearSortButtonDescription = localize('positron.clearSortButtonDescription', "Clear sorting");

/**
 * ActionBar component.
 * @returns The rendered component.
 */
export const ActionBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	const [clientStatus, setClientStatus] = useState(context.instance.dataExplorerClientInstance.status);

	// Main useEffect. This is where we set up event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Set up event handler for backend state sync updating the filter bar
		disposableStore.add(context.instance.dataExplorerClientInstance.onDidStatusUpdate(
			status => setClientStatus(status)
		));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context.instance.dataExplorerClientInstance]);

	const getStatusText = () => {
		// TODO: localize
		switch (clientStatus) {
			case DataExplorerClientStatus.Idle:
				return 'Idle';
			case DataExplorerClientStatus.Computing:
				return 'Computing';
			case DataExplorerClientStatus.Disconnected:
				return 'Disconnected';
			case DataExplorerClientStatus.Error:
				return 'Error';
		}
	};

	const getStatusClass = () => {
		switch (clientStatus) {
			case DataExplorerClientStatus.Idle:
				return 'idle';
			case DataExplorerClientStatus.Computing:
				return 'computing';
			case DataExplorerClientStatus.Disconnected:
				return 'disconnected';
			case DataExplorerClientStatus.Error:
				return 'error';
		}
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...context}>
			<div className='action-bar'>
				<PositronActionBar
					size='small'
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							disabled={false}
							iconId='positron-clear-sorting'
							text={clearSortButtonTitle}
							tooltip={clearSortButtonDescription}
							ariaLabel={clearSortButtonDescription}
							onPressed={() =>
								context.instance.tableDataDataGridInstance.clearColumnSortKeys()
							}
						/>
						<ActionBarSeparator />
						<Button
							className={`status-indicator ${getStatusClass()}`}
						>
							<div className='title'>
								{getStatusText()}
							</div>
						</Button>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<LayoutMenuButton />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
