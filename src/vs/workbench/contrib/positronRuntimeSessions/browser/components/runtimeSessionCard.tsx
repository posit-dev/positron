/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeSessionCard';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { RuntimeClientList } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/runtimeClientList';
import { DisposableStore } from 'vs/base/common/lifecycle';

interface runtimeSessionCardProps {
	readonly session: ILanguageRuntimeSession;
}

/**
 * The RuntimeSessionCard component shows a card that contains the runtime
 * session details (such as its associated runtime's ID and interpreter path)
 * and action buttons for the session.
 *
 * @param props The runtimeSessionCardProps that contains the component properties.
 *
 * @returns The rendered component.
 */
export const RuntimeSessionCard = (props: runtimeSessionCardProps) => {

	const [sessionState, setSessionState] = useState(props.session.getRuntimeState());

	const shutdownSession = () => {
		props.session.shutdown(RuntimeExitReason.Shutdown);
	};

	const forceQuitSession = () => {
		props.session.forceQuit();
	};

	const restartSession = () => {
		props.session.restart();
	};

	const interruptSession = () => {
		props.session.interrupt();
	};

	const showOutput = () => {
		props.session.showOutput();
	};

	// Main useEffect hook.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.session.onDidChangeRuntimeState(state => {
			setSessionState(state);
		}));
		return () => disposableStore.dispose();
	});

	return (
		<tr>
			<td colSpan={4}>
				<div className='runtime-session-card'>
					<div className='runtime-icon'>
						<img src={'data:image/svg+xml;base64,' + props.session.runtimeMetadata.base64EncodedIconSvg} />
					</div>
					<div className='runtime-name'>
						{props.session.runtimeMetadata.runtimeName}
						&nbsp;
						<span className='runtime-extension'>
							[{props.session.runtimeMetadata.extensionId.value}]
						</span>
					</div>
					<div className='runtime-id'>
						{props.session.runtimeMetadata.runtimeId}
					</div>
					<div className='runtime-started'>
						Started {new Date(props.session.metadata.createdTimestamp).toLocaleString()}
					</div>
					<div className='runtime-started-reason'>
						{props.session.metadata.startReason}
					</div>
					<div className='runtime-path'>
						{props.session.runtimeMetadata.runtimePath}
					</div>
				</div>
				<div className='runtime-action-buttons'>
					{sessionState !== RuntimeState.Exited && <button onClick={forceQuitSession}>force quit</button>}
					{sessionState !== RuntimeState.Exited && <button onClick={shutdownSession}>shut down</button>}
					{sessionState !== RuntimeState.Exited && <button onClick={restartSession}>restart</button>}
					{sessionState === RuntimeState.Busy && <button onClick={interruptSession}>interrupt</button>}
					<button onClick={showOutput}>output log</button>
				</div>
				{props.session.clientInstances.length > 0 &&
					<RuntimeClientList session={props.session} />}
			</td>
		</tr>
	);
};
