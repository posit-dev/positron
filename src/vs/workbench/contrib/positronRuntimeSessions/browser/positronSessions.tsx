/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronSessions';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronSessionsServices } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronSessionsState';
import { PositronSessionsContextProvider } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronSessionsContext';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * PositronSessionsProps interface.
 */
export interface PositronSessionsProps extends PositronSessionsServices {
	// Services.
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronSessions component.
 * @param props A PositronSessionsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronSessions = (props: PropsWithChildren<PositronSessionsProps>) => {
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
	}, []);

	// Render.
	return (
		<PositronSessionsContextProvider {...props}>
			<div className='positron-sessions'>
				<h1>sessions! {width} x {height}</h1>
			</div>
		</PositronSessionsContextProvider>
	);
};
