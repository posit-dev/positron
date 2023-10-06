/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterActions';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ILanguageRuntime, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * InterpreterActionsProps interface.
 */
interface InterpreterActionsProps {
	runtime: ILanguageRuntime;
	onStart: () => void;
}

/**
 * InterpreterActions component.
 * @param props A InterpreterActionsProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterActions = (props: PropsWithChildren<InterpreterActionsProps>) => {
	// State hooks.
	const [runtimeState, setRuntimeState] = useState(props.runtime.getRuntimeState());

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler.
		disposableStore.add(props.runtime.onDidChangeRuntimeState(runtimeState => {
			setRuntimeState(runtimeState);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

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
					onClick={() => props.runtime.interrupt()}
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
					onClick={() => props.runtime.restart()}
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
				<PositronButton className='action-button' onClick={() => props.runtime.shutdown()}>
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
				<PositronButton className='action-button' onClick={() => props.onStart()}>
					<span
						className='codicon codicon-positron-power-button'
						title={localize('positronStartTheInterpreter', "Start the interpreter")}
					/>
				</PositronButton>
			}
		</div>
	);
};
