/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataExplorer';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import { ActionBar } from 'vs/workbench/browser/positronDataExplorer/components/actionBar/actionBar';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { PositronDataExplorerContextProvider } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { DataExplorerPanel } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/dataExplorerPanel';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';

/**
 * PositronDataExplorerServices interface.
 */
export interface PositronDataExplorerServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
	readonly layoutService: ILayoutService;
}

/**
 * PositronDataExplorerConfiguration interface.
 */
export interface PositronDataExplorerConfiguration extends PositronDataExplorerServices {
	readonly instance: IPositronDataExplorerInstance;
}

/**
 * PositronDataExplorerProps interface.
 */
export interface PositronDataExplorerProps extends PositronDataExplorerConfiguration {
	onClose: () => void;
}

/**
 * PositronDataExplorer component.
 * @param props A PositronDataExplorerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataExplorer = (props: PropsWithChildren<PositronDataExplorerProps>) => {
	// State hooks.
	const [closed, setClosed] = useState(false);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidUpdateBackendState event handler.
		disposableStore.add(props.instance.onDidClose(() => {
			setClosed(true);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.instance]);

	// Render.
	return (
		<PositronDataExplorerContextProvider {...props}>
			<div className='positron-data-explorer'>
				<ActionBar />
				<DataExplorerPanel />
				{closed && (
					<div className='positron-data-explorer-overlay'>
						<PositronButton className='message' onPressed={props.onClose}>
							<div className='message-line'>
								{localize(
									'positron.dataExplorer.dataDisplayName',
									'{0} Data: {1}',
									props.instance.languageName,
									props.instance.dataExplorerClientInstance.cachedBackendState?.display_name
								)}
							</div>
							<div className='message-line'>
								{localize(
									'positron.dataExplorer.isNoLongerAvailable',
									'is no longer available'
								)}
							</div>
							<div className='message-line close'>{(() => localize('positron.dataExplorer.clickToClose', "Click To Close"))()}</div>
						</PositronButton>
					</div>
				)}
			</div>
		</PositronDataExplorerContextProvider>
	);
};
