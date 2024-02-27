/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeSession';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

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
* RuntimeSession component.
* @param props A RuntimeSessionProps that contains the component properties.
* @returns The rendered component.
*/
export const RuntimeSession = (props: RuntimeSessionProps) => {

	const [sessionState, setSessionState] = useState(props.session.getRuntimeState());

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));
	});

	// Render.
	return (
		<tr className={'runtime-session ' + props.session.getRuntimeState()}>
			<td>
				{props.session.sessionName}
			</td>
			<td>
				{sessionState}
			</td>
			<td>
				{props.session.sessionId}
			</td>
			<td>
				{props.session.sessionMode}
			</td>
		</tr>
	);
};
