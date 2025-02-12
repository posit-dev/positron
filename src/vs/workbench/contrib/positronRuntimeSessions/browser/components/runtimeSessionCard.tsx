/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeSessionCard.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { RuntimeClientList } from './runtimeClientList.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

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

	const [sessionState, setSessionState] = useState(() => props.session.getRuntimeState());

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
	}, [props.session]);

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
