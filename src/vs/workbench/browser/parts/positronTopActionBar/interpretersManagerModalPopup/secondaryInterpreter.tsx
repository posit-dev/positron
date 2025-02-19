/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './secondaryInterpreter.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { InterpreterActions } from './interpreterActions.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * SecondaryInterpreterProps interface.
 */
interface SecondaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtimeSessionService: IRuntimeSessionService;
	runtime: ILanguageRuntimeMetadata;
	onStart: () => void;
	onActivate: () => void;
}

/**
 * SecondaryInterpreter component.
 * @param props A SecondaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const SecondaryInterpreter = (props: SecondaryInterpreterProps) => {
	// State hooks.

	// Get the console session for this runtime, if any.
	const consoleSession = props.runtimeSessionService.getConsoleSessionForRuntime(
		props.runtime.runtimeId);

	const [session, setSession] = useState(consoleSession);
	const [runtimeState, setRuntimeState] = useState(session?.getRuntimeState() || RuntimeState.Uninitialized);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		if (session) {
			// If we have a session, add a listener for runtime state changes.
			disposableStore.add(session.onDidChangeRuntimeState(state => {
				setRuntimeState(state);
			}));
		} else {
			// If we don't have a session, add a listener for when a session is created.
			disposableStore.add(props.runtimeSessionService.onDidStartRuntime(session => {
				// If the session is for this runtime, set the session and runtime state.
				if (session.runtimeMetadata.runtimeId === props.runtime.runtimeId) {
					setSession(session);
					setRuntimeState(session.getRuntimeState());
				}
			}));
		}

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.runtime.runtimeId, props.runtimeSessionService, session]);

	// Render.
	return (
		<PositronButton className='secondary-interpreter' onPressed={props.onActivate}>
			<div></div>
			<div className='running-indicator'>
				{runtimeState !== RuntimeState.Uninitialized && runtimeState !== RuntimeState.Exited
					&&
					<div className='running-icon codicon codicon-circle-large-filled'></div>
				}
			</div>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.runtimeShortName}</div>
					<div className='line light' title={props.runtime.runtimePath}>{props.runtime.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.runtime}
				runtimeSessionService={props.runtimeSessionService}
				onStart={props.onStart} />
		</PositronButton>
	);
};
