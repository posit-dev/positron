/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./positronDataTool';

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ActionBar } from 'vs/base/browser/ui/positronDataTool/components/actionBar/actionBar';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { DataToolPanel } from 'vs/base/browser/ui/positronDataTool/components/dataToolPanel/dataToolPanel';
import { PositronDataToolContextProvider } from 'vs/base/browser/ui/positronDataTool/positronDataToolContext';
import { IPositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolInstance';

/**
 * PositronDataToolServices interface.
 */
export interface PositronDataToolServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
}

/**
 * PositronDataToolConfiguration interface.
 */
export interface PositronDataToolConfiguration extends PositronDataToolServices {
	readonly instance: IPositronDataToolInstance;
}

/**
 * PositronDataToolProps interface.
 */
export interface PositronDataToolProps extends PositronDataToolConfiguration {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronDataTool component.
 * @param props A PositronDataToolProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronDataTool = (props: PropsWithChildren<PositronDataToolProps>) => {
	// State hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<PositronDataToolContextProvider {...props}>
			<div className='positron-data-tool'>
				<ActionBar {...props} />
				<DataToolPanel
					width={width}
					height={height - 32}
					{...props}
				/>
			</div>
		</PositronDataToolContextProvider>
	);
};
