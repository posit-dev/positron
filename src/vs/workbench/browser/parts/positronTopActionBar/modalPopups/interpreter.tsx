/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreter';
import * as React from 'react';
import { MouseEvent, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * InterpreterProps interface.
 */
interface InterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	primaryRuntime: boolean;
	showAll: () => void;
	dismiss: () => void;
}

/**
 * InterpreterGroup component.
 * @param props A InterpreterGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const Interpreter = (props: InterpreterProps) => {
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

	const showAllVersionsClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.showAll();
	};

	const interruptClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	const restartClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	const shutdownClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.shutdown();
	};

	const startClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.start();
	};

	// Render.
	return (
		<div className='interpreter'>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageName} {props.runtime.metadata.languageVersion}</div>
					{/* <div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div> */}
					<div className='line light'>{runtimeState}</div>
				</div>
			</div>
			<div className='actions'>
				{props.primaryRuntime &&
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
						disabled={runtimeState === RuntimeState.Interrupting}
						className='action-button codicon codicon-positron-interrupt-runtime'
						title={localize('positronInterruptInterpreter', "Interrupt the interpreter")}
						style={{ color: 'red' }}
						onClick={interruptClickHandler}
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
						className='action-button codicon codicon-positron-restart-runtime'
						title={localize('positronRestartInterpreter', "Restart the interpreter")}
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
		</div>
	);
};
