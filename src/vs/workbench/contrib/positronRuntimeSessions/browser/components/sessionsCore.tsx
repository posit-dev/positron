/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBars } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/actionBars';
import { PositronSessionsProps } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronSessions';
import { usePositronSessionsContext } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronSessionsContext';
import { RuntimeSession } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/runtimeSession';

// SessionsCoreProps interface.
interface SessionsCoreProps extends PositronSessionsProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * SessionsCore component.
 * @param props A SessionsCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const SessionsCore = (props: SessionsCoreProps) => {
	// Context hooks.
	const positronSessionsContext = usePositronSessionsContext();

	// If there are no instances, render nothing.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (!positronSessionsContext.positronSessions.length) {
		return null;
	}

	// Calculate the adjusted height (the height minus the action bars height).
	const adjustedHeight = props.height - 64;

	// Render.
	return (
		<div className='sessions-core'>
			<ActionBars {...props} />
			<div className='variables-instances-container' style={{ width: props.width, height: adjustedHeight }}>
				{positronSessionsContext.positronSessions.map(session =>
					<RuntimeSession
						key={session.sessionId}
						width={props.width}
						height={adjustedHeight}
						session={session}
						reactComponentContainer={props.reactComponentContainer} />
				)}
			</div>
		</div>
	);
};
