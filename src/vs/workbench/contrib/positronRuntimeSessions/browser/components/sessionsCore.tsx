/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./sessionsCore';
import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBars } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/actionBars';
import { PositronSessionsProps } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessions';
import { usePositronRuntimeSessionsContext } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsContext';
import { RuntimeSession } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/runtimeSession';

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

	if (!positronSessionsContext.positronSessions.length) {
		return null;
	}

	// Calculate the adjusted height (the height minus the action bars height).
	const adjustedHeight = props.height - 64;

	// Sort sessions by created time, so that most recent sessions are at the
	// top.
	const allSessions = positronSessionsContext.positronSessions.sort((a, b) => {
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
							width={props.width}
							height={adjustedHeight}
							session={session}
							reactComponentContainer={props.reactComponentContainer} />
					)}
				</table>
			</div>
		</div>
	);
};
