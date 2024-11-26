/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataExplorer.css';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ILayoutService } from '../../../platform/layout/browser/layoutService.js';
import { IClipboardService } from '../../../platform/clipboard/common/clipboardService.js';
import { IAccessibilityService } from '../../../platform/accessibility/common/accessibility.js';
import { ActionBar } from './components/actionBar/actionBar.js';
import { PositronActionBarServices } from '../../../platform/positronActionBar/browser/positronActionBarState.js';
import { PositronDataExplorerContextProvider } from './positronDataExplorerContext.js';
import { DataExplorerPanel } from './components/dataExplorerPanel/dataExplorerPanel.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerClosed, PositronDataExplorerClosedStatus } from './components/dataExplorerClosed/positronDataExplorerClosed.js';

/**
 * PositronDataExplorerServices interface.
 */
export interface PositronDataExplorerServices extends PositronActionBarServices {
	readonly accessibilityService: IAccessibilityService;
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

export enum PositronDataExplorerUiStatus {
	OPEN = 'open',
	UNAVAILABLE = 'unavailable',
	ERROR = 'error'
}

/**
 * PositronDataExplorer component.
 * @param props A PositronDataExplorerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataExplorer = (props: PropsWithChildren<PositronDataExplorerProps>) => {
	// State hooks.
	const [closed, setClosed] = useState(false);
	const [reason, setReason] = useState(PositronDataExplorerClosedStatus.UNAVAILABLE);
	const [errorMessage, setErrorMessage] = useState('');

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidClose event handler.
		disposableStore.add(props.instance.onDidClose(() => {
			setClosed(true);
		}));

		disposableStore.add(props.instance.dataExplorerClientInstance.onDidUpdateBackendState((state) => {
			if (state.connected === false) {
				setClosed(true);
				if (state.error_message) {
					setReason(PositronDataExplorerClosedStatus.ERROR);
					setErrorMessage(state.error_message);
				}
			}
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
					<PositronDataExplorerClosed
						closedReason={reason}
						errorMessage={errorMessage}
						onClose={props.onClose}
					/>
				)}
			</div>
		</PositronDataExplorerContextProvider>
	);
};
