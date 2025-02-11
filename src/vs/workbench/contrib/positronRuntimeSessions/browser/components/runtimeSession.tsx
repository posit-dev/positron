/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeSession.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeSessionCard } from './runtimeSessionCard.js';

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

	const [sessionState, setSessionState] = useState(() => props.session.getRuntimeState());
	const [expanded, setExpanded] = useState(false);

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));
		return () => disposableStore.dispose();
	}, [props.session]);

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
