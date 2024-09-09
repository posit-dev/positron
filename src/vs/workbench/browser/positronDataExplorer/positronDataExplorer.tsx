/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataExplorer';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ActionBar } from 'vs/workbench/browser/positronDataExplorer/components/actionBar/actionBar';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { PositronDataExplorerContextProvider } from 'vs/workbench/browser/positronDataExplorer/positronDataExplorerContext';
import { DataExplorerPanel } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/dataExplorerPanel';
import { IPositronDataExplorerInstance } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance';
import { PositronDataExplorerClosed } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerClosed/positronDataExplorerClosed';

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

		// Add the onDidClose event handler.
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
				{closed && <PositronDataExplorerClosed onClose={props.onClose} />}
			</div>
		</PositronDataExplorerContextProvider>
	);
};
