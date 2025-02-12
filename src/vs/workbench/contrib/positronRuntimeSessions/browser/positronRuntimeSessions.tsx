/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronRuntimeSessions.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { PositronSessionsServices } from './positronRuntimeSessionsState.js';
import { PositronSessionsContextProvider } from './positronRuntimeSessionsContext.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { SessionsCore } from './components/sessionsCore.js';

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
	}, [props.reactComponentContainer]);

	// Render.
	return (
		<PositronSessionsContextProvider {...props}>
			<div className='positron-sessions'>
				<SessionsCore {...props} height={_height} width={_width} />
			</div>
		</PositronSessionsContextProvider>
	);
};
