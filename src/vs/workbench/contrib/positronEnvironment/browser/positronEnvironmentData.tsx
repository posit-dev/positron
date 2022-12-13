/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronEnvironmentData';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';

/**
 * PositronEnvironmentDataProps interface.
 */
export interface PositronEnvironmentDataProps {
	initialHeight: () => number;
	reactComponentContainer: IReactComponentContainer;
}


/**
 * TemporaryRow component.
 * @param props A ListChildComponentProps that contains the component properties.
 * @returns The rendered component.
 */
const TemporaryRow = (props: ListChildComponentProps) => {
	return (
		<div className={props.index % 2 ? 'list-item-odd' : 'list-item-even'} style={props.style}>
			<div className='list-item'>
				Environment Row {props.index}
			</div>
		</div>
	);
};

/**
 * PositronEnvironmentData component.
 * @param props A PositronEnvironmentDataProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronEnvironmentData = (props: PropsWithChildren<PositronEnvironmentDataProps>) => {
	// Hooks.
	const [height, setHeight] = useState(props.initialHeight());

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			console.log(`Setting size - height is now ${size.height}`);
			setHeight(size.height - 64);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visibility => {
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	console.log(`Rendering PositronEnvironmentData height ${height}`);

	// Render.
	return (
		<div>
			<List height={height} itemCount={1000} itemSize={28} width='100%'>
				{TemporaryRow}
			</List>
		</div>
	);
};
