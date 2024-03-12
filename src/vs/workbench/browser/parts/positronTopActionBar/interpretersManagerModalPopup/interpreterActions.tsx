/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterActions';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

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
	}, []);

	// Interrupt the session, if we have one.
	const interrupt = () => {
		if (session) {
			session.interrupt();
		}
	};

	// Restart the session, if we have one.
	const restart = () => {
		if (session) {
			session.restart();
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
						title={localize('positronInterruptInterpreter', "Interrupt the interpreter")}
						style={{ color: 'red' }}
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
						title={localize('positronRestartInterpreter', "Restart the interpreter")}
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
						title={localize('positronStopTheInterpreter', "Stop the interpreter")}
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
						title={localize('positronStartTheInterpreter', "Start the interpreter")}
					/>
				</PositronButton>
			}
		</div>
	);
};
