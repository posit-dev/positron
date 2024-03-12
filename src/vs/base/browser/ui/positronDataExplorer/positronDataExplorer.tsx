/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataExplorer';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ActionBar } from 'vs/base/browser/ui/positronDataExplorer/components/actionBar/actionBar';
import { DataExplorerPanel } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/dataExplorerPanel';
import { PositronDataExplorerContextProvider } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';
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
export interface PositronDataExplorerProps extends PositronDataExplorerConfiguration { }

/**
 * PositronDataExplorer component.
 * @param props A PositronDataExplorerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataExplorer = (props: PropsWithChildren<PositronDataExplorerProps>) => {
	// Render.
	return (
		<PositronDataExplorerContextProvider {...props}>
			<div className='positron-data-explorer'>
				<ActionBar />
				<DataExplorerPanel />
			</div>
		</PositronDataExplorerContextProvider>
	);
};
