/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronVariables.css';

// React.
import { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { VariablesCore } from './components/variablesCore.js';
import { PositronVariablesContextProvider } from './positronVariablesContext.js';

/**
 * PositronVariablesProps interface.
 */
export interface PositronVariablesProps {
	// Services.
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronVariables component.
 * @param props A PositronVariablesProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronVariables = (props: PropsWithChildren<PositronVariablesProps>) => {
	// State hooks.
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
		<PositronVariablesContextProvider {...props}>
			<div className='positron-variables'>
				<VariablesCore height={height} width={width} {...props} />
			</div>
		</PositronVariablesContextProvider>
	);
};
