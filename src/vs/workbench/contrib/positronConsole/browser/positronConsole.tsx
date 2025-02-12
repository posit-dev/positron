/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronConsole.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { ConsoleCore } from './components/consoleCore.js';
import { PositronConsoleServices } from './positronConsoleState.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PositronConsoleContextProvider } from './positronConsoleContext.js';
import { createTrustedTypesPolicy } from '../../../../base/browser/trustedTypes.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';

// Create the trusted types policy.
export const ttPolicy = createTrustedTypesPolicy('positronConsole', { createHTML: value => value });

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
	}, [props.reactComponentContainer]);

	// Render.
	return (
		<PositronConsoleContextProvider {...props}>
			<div className='positron-console'>
				<ConsoleCore {...props} height={height} width={width} />
			</div>
		</PositronConsoleContextProvider>
	);
};
