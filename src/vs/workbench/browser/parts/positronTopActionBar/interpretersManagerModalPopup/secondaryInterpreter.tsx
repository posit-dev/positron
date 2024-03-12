/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./secondaryInterpreter';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterActions';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

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
	}, []);

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
				runtimeSessionService={props.runtimeSessionService}
				runtime={props.runtime}
				onStart={props.onStart} />
		</PositronButton>
	);
};
