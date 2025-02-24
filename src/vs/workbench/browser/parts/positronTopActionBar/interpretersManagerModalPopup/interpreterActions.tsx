/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './interpreterActions.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';

/**
 * InterpreterActionsProps interface.
 */
interface InterpreterActionsProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtimeSessionService: IRuntimeSessionService;
	runtime: ILanguageRuntimeMetadata;
	onStart: () => void;
}

/**
 * InterpreterActions component.
 * @param props A InterpreterActionsProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterActions = (props: PropsWithChildren<InterpreterActionsProps>) => {
	// Get a console session for this runtime, if it exists.
	const consoleSession =
		props.runtimeSessionService.getConsoleSessionForRuntime(props.runtime.runtimeId);

	// State hooks.
	const [runtimeState, setRuntimeState] = useState(consoleSession ? consoleSession.getRuntimeState() :
		RuntimeState.Uninitialized);

	// State hooks.
	const [session, setSession] = useState(consoleSession);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// If a console session exists, listen for changes to its runtime state.
		if (session) {
			disposableStore.add(session.onDidChangeRuntimeState(runtimeState => {
				setRuntimeState(runtimeState);
			}));
		}

		// Listen for new console sessions that are started. When a new session
		// is started for the runtime that this component is managing, attach to
		// it.
		disposableStore.add(props.runtimeSessionService.onWillStartSession(e => {
			if (e.session.metadata.sessionMode === LanguageRuntimeSessionMode.Console &&
				e.session.runtimeMetadata.runtimeId === props.runtime.runtimeId) {
				setSession(session);
			}
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.runtime.runtimeId, props.runtimeSessionService, session]);

	// Interrupt the session, if we have one.
	const interrupt = () => {
		if (session) {
			session.interrupt();
		}
	};

	// Restart the session, if we have one.
	const restart = () => {
		if (session) {
			props.runtimeSessionService.restartSession(
				session.sessionId, 'Restarted from top action bar');
		}
	};

	// Shut down the session, if we have one.
	const shutdown = () => {
		if (session) {
			session.shutdown();
		}
	};

	// Render.
	return (
		<div className='interpreter-actions'>
			{props.children}

			{/*
				Interrupt button.
			*/}
			{(
				runtimeState === RuntimeState.Busy ||
				runtimeState === RuntimeState.Interrupting
			) &&
				<PositronButton
					className='action-button'
					disabled={runtimeState === RuntimeState.Interrupting}
					onPressed={interrupt}
				>
					<span
						className='codicon codicon-positron-interrupt-runtime'
						style={{ color: 'red' }}
						title={(() => localize('positronInterruptInterpreter', "Interrupt the interpreter"))()}
					/>
				</PositronButton>
			}

			{/*
				Restart button.
			*/}
			{(
				runtimeState !== RuntimeState.Uninitialized
			) &&
				<PositronButton
					className='action-button'
					disabled={runtimeState !== RuntimeState.Ready && runtimeState !== RuntimeState.Idle}
					onPressed={restart}
				>
					<span
						className='codicon codicon-positron-restart-runtime'
						title={(() => localize('positronRestartInterpreter', "Restart the interpreter"))()}
					/>
				</PositronButton>
			}

			{/*
				Shutdown button.
			*/}
			{(
				runtimeState === RuntimeState.Ready ||
				runtimeState === RuntimeState.Idle ||
				runtimeState === RuntimeState.Busy ||
				runtimeState === RuntimeState.Exiting ||
				runtimeState === RuntimeState.Offline ||
				runtimeState === RuntimeState.Interrupting
			) &&
				<PositronButton className='action-button' onPressed={shutdown}>
					<span
						className='codicon codicon-positron-power-button'
						title={(() => localize('positronStopTheInterpreter', "Stop the interpreter"))()}
					/>
				</PositronButton>
			}

			{/*
				Start button.
			*/}
			{(
				runtimeState === RuntimeState.Uninitialized ||
				runtimeState === RuntimeState.Initializing ||
				runtimeState === RuntimeState.Starting ||
				runtimeState === RuntimeState.Exited
			) &&
				<PositronButton className='action-button' onPressed={() => props.onStart()}>
					<span
						className='codicon codicon-positron-power-button'
						title={(() => localize('positronStartTheInterpreter', "Start the interpreter"))()}
					/>
				</PositronButton>
			}
		</div>
	);
};
