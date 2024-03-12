/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeSession';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { RuntimeSessionCard } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/runtimeSessionCard';

/**
 * RuntimeSessionProps interface.
 */
interface RuntimeSessionProps {
	readonly width: number;
	readonly height: number;
	readonly session: ILanguageRuntimeSession;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * RuntimeSession component. This component displays a single runtime session
 * row in the runtime session list.
 *
 * @param props A RuntimeSessionProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeSession = (props: RuntimeSessionProps) => {

	const [sessionState, setSessionState] = useState(props.session.getRuntimeState());
	const [expanded, setExpanded] = useState(false);

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));
		return () => disposableStore.dispose();
	});

	// Render.
	return (
		<tbody className={'status-' + props.session.getRuntimeState()}>
			<tr className='runtime-session'>
				<td>
					<a href='#' onClick={() => setExpanded(!expanded)}>
						<span className={'codicon ' + (expanded ? 'codicon-chevron-down' : 'codicon-chevron-right')}></span>
						&nbsp;
						{props.session.metadata.sessionName}
					</a>
				</td>
				<td>
					{sessionState}
				</td>
				<td>
					{props.session.sessionId}
				</td>
				<td>
					{props.session.metadata.sessionMode}
				</td>
			</tr>
			{expanded && <RuntimeSessionCard session={props.session} />}
		</tbody>
	);
};
