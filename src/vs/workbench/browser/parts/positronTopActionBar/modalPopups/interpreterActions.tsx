/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterActions';
import * as React from 'react';
import { MouseEvent, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * InterpreterActionsCommonProps interface.
 */
interface InterpreterActionsProps {
	runtime: ILanguageRuntime;
	onStart: () => void;
}

/**
 * PrimaryRuntimeProps type.
 */
type PrimaryRuntimeProps =
	| { isPrimaryRuntime: false; onShowAllVersions?: never }
	| { isPrimaryRuntime: true; onShowAllVersions: () => void };

/**
 * InterpreterActions component.
 * @param props A InterpreterActionsProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterActions = (props: InterpreterActionsProps & PrimaryRuntimeProps) => {
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

	/**
	 * showAllVersionsClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const showAllVersionsClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Show all versions.
		props.onShowAllVersions?.();
	};

	/**
	 * interruptClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const interruptClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Interrupt the runtime.
		props.runtime.interrupt();
	};

	/**
	 * restartClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const restartClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Restart the runtime.
		props.runtime.restart();
	};

	/**
	 * shutdownClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const shutdownClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Shutdown the runtime.
		props.runtime.shutdown();
	};

	/**
	 * startClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const startClickHandler = async (e: MouseEvent<HTMLButtonElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Start the interpreter.
		props.onStart();
	};

	// Render.
	return (
		<div className='interpreter-actions'>
			{props.isPrimaryRuntime &&
				<button
					className='action-button codicon codicon-positron-more-options'
					title={localize('positronShowAllVersions', "Show all versions")}
					onClick={showAllVersionsClickHandler}
				/>
			}

			{(
				runtimeState === RuntimeState.Busy ||
				runtimeState === RuntimeState.Interrupting
			) &&
				<button
					className='action-button codicon codicon-positron-interrupt-runtime'
					title={localize('positronInterruptInterpreter', "Interrupt the interpreter")}
					style={{ color: 'red' }}
					disabled={runtimeState === RuntimeState.Interrupting}
					onClick={interruptClickHandler}
				/>
			}

			{(
				runtimeState !== RuntimeState.Uninitialized
			) &&
				<button
					className='action-button codicon codicon-positron-restart-runtime'
					title={localize('positronRestartInterpreter', "Restart the interpreter")}
					disabled={runtimeState !== RuntimeState.Ready && runtimeState !== RuntimeState.Idle}
					onClick={restartClickHandler}
				/>
			}

			{(
				runtimeState === RuntimeState.Ready ||
				runtimeState === RuntimeState.Idle ||
				runtimeState === RuntimeState.Busy ||
				runtimeState === RuntimeState.Exiting ||
				runtimeState === RuntimeState.Offline ||
				runtimeState === RuntimeState.Interrupting
			) &&
				<button
					className='action-button codicon codicon-positron-power-button'
					title={localize('positronStopTheInterpreter', "Stop the interpreter")}
					style={{ color: 'green' }}
					onClick={shutdownClickHandler}
				/>
			}

			{(
				runtimeState === RuntimeState.Uninitialized ||
				runtimeState === RuntimeState.Initializing ||
				runtimeState === RuntimeState.Starting ||
				runtimeState === RuntimeState.Exited
			) &&
				<button
					className='action-button codicon codicon-positron-power-button'
					title={localize('positronStartTheInterpreter', "Start the interpreter")}
					onClick={startClickHandler}
				/>
			}
		</div>
	);
};
