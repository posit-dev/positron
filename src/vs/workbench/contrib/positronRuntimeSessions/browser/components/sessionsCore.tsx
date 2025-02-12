/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './sessionsCore.css';

// React.
import React from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ActionBars } from './actionBars.js';
import { PositronSessionsProps } from '../positronRuntimeSessions.js';
import { usePositronRuntimeSessionsContext } from '../positronRuntimeSessionsContext.js';
import { RuntimeSession } from './runtimeSession.js';

// SessionsCoreProps interface.
interface SessionsCoreProps extends PositronSessionsProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * SessionsCore component.
 *
 * This component displays the core of the runtime sessions view. It contains
 * the action bar and the list of runtime sessions in a table.
 *
 * @param props A SessionsCoreProps that contains the component properties.
 *
 * @returns The rendered component.
 */
export const SessionsCore = (props: SessionsCoreProps) => {
	// Context hooks.
	const positronSessionsContext = usePositronRuntimeSessionsContext();

	if (!positronSessionsContext.positronSessions.size) {
		return null;
	}

	// Calculate the adjusted height (the height minus the action bars height).
	const adjustedHeight = props.height - 64;

	// Sort sessions by created time, so that most recent sessions are at the
	// top.
	const allSessions = Array.from(positronSessionsContext.positronSessions.values()).sort((a, b) => {
		return b.metadata.createdTimestamp - a.metadata.createdTimestamp;
	});

	return (
		<div className='sessions-core'>
			<ActionBars {...props} />
			<div className='sessions-container' style={{ width: props.width, height: adjustedHeight }}>
				<table className='sessions-list'>
					<thead>
						<tr>
							<th>Name</th>
							<th>State</th>
							<th>ID</th>
							<th>Kind</th>
						</tr>
					</thead>
					{allSessions.map(session =>
						<RuntimeSession
							key={session.sessionId}
							height={adjustedHeight}
							reactComponentContainer={props.reactComponentContainer}
							session={session}
							width={props.width} />
					)}
				</table>
			</div>
		</div>
	);
};
