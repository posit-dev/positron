/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronConsole';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ConsoleCore } from 'vs/workbench/contrib/positronConsole/browser/components/consoleCore';
import { PositronConsoleServices } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleState';
import { PositronConsoleContextProvider } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

/**
 * PositronConsoleProps interface.
 */
export interface PositronConsoleProps extends PositronConsoleServices {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronConsole component.
 * @param props A PositronConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronConsole = (props: PropsWithChildren<PositronConsoleProps>) => {
	// Hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);

	// Add IReactComponentContainer event handlers.
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
		<PositronConsoleContextProvider {...props}>
			<div className='positron-console'>
				<ConsoleCore width={width} height={height} {...props} />
			</div>
		</PositronConsoleContextProvider>
	);
};
