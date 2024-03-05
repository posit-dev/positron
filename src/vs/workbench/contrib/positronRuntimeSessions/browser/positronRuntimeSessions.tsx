/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronRuntimeSessions';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { PositronSessionsServices } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsState';
import { PositronSessionsContextProvider } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsContext';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { SessionsCore } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/sessionsCore';

/**
 * PositronSessionsProps interface.
 */
export interface PositronSessionsProps extends PositronSessionsServices {
	// Services.
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronSessions component.
 * @param props A PositronSessionsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronSessions = (props: PropsWithChildren<PositronSessionsProps>) => {
	// State hooks.
	const [_width, setWidth] = useState(props.reactComponentContainer.width);
	const [_height, setHeight] = useState(props.reactComponentContainer.height);

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
				<SessionsCore {...props} width={_width} height={_height} />
			</div>
		</PositronSessionsContextProvider>
	);
};
