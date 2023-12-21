/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronDataTool';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBar } from 'vs/workbench/contrib/positronDataTool/browser/components/actionBar';
import { DataToolPanel } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolPanel';
import { PositronDataToolConfiguration } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolState';
import { PositronDataToolContextProvider } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';

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
				<DataToolPanel width={width} height={height - 32} {...props} />
			</div>
		</PositronDataToolContextProvider>
	);
};
