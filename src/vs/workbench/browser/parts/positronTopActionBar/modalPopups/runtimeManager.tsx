/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeManager';
import * as React from 'react';
import { KeyboardEvent, MouseEvent, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeService, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * RuntimeManagerProps interface.
 */
interface RuntimeManagerProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	dismiss: () => void;
}

/**
 * RuntimeManager component.
 * @param props A RuntimeManagerProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeManager = (props: RuntimeManagerProps) => {
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
	 * runtimeKey event handler.
	 */
	const runtimeKeyDownHandler = (e: KeyboardEvent<HTMLDivElement>) => {
		switch (e.code) {
			case 'Space':
			case 'Enter':
				e.preventDefault();
				e.stopPropagation();
				props.languageRuntimeService.activeRuntime = props.runtime;
				props.dismiss();
				break;
		}
	};


	/**
	 * runtimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const runtimeClickHandler = (e: MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.languageRuntimeService.activeRuntime = props.runtime;
		props.dismiss();
	};

	/**
	 * startRuntimeClickHandler event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const startRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.start();
		//props.dismiss();
	};

	/**
	 * stopRuntimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const stopRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.shutdown();
	};

	/**
	 * restartRuntimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const restartRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.restart();
	};

	/**
	 * interruptRuntimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const interruptRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.interrupt();
	};

	let actions;
	switch (runtimeState) {
		case RuntimeState.Uninitialized:
			actions = (
				<div className='actions'>
					<button className='action-button codicon codicon-positron-more-options' title={localize('positronStartTheInterpreter', "Start the interpreter")} onClick={startRuntimeClickHandler} />
					<button className='action-button codicon codicon-positron-power-button' style={{ color: 'green' }} title={localize('positronStartTheInterpreter', "Start the interpreter")} onClick={startRuntimeClickHandler} />
				</div>
			);
			break;

		case RuntimeState.Initializing:
			actions = null;
			break;

		case RuntimeState.Starting:
			actions = null;
			break;

		case RuntimeState.Ready:
		case RuntimeState.Idle:
			actions = (
				<div className='actions'>
					<button className='action-button codicon codicon-positron-restart-runtime' style={{ color: 'green' }} title={localize('positronRestartTheInterpreter', "Restart the interpreter")} onClick={restartRuntimeClickHandler} />
					<button className='action-button codicon codicon-positron-power-button' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
				</div>
			);
			break;

		case RuntimeState.Busy:
			actions = (
				<div className='actions'>
					<button className='action-button codicon codicon-positron-interrupt' style={{ color: 'red' }} title={localize('positronInterruptTheInterpreter', "Interrupts the interpreter")} onClick={interruptRuntimeClickHandler} />
					<button className='action-button codicon codicon-positron-restart-runtime' style={{ color: 'green' }} title={localize('positronRestartsTheInterpreter', "Restarts the interpreter")} onClick={restartRuntimeClickHandler} />
					<button className='action-button codicon codicon-positron-power-button' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
				</div>
			);
			break;

		case RuntimeState.Exiting:
			actions = (
				<div className='actions'>
					<button className='action-button codicon codicon-positron-power-button' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
				</div>
			);
			break;

		case RuntimeState.Exited:
			actions = (
				<div className='actions'>
					<button className='action-button codicon codicon-positron-power-button' style={{ color: 'green' }} title={localize('positronStartTheInterpreter', "Start the interpreter")} onClick={startRuntimeClickHandler} />
				</div>
			);
			break;

		case RuntimeState.Offline:
			actions = null;
			break;

		case RuntimeState.Interrupting:
			actions = null;
			break;
	}

	// Render.
	return (
		<div className='runtime-manager' role='button' tabIndex={0} onKeyDown={runtimeKeyDownHandler} onClick={runtimeClickHandler}>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageName} {props.runtime.metadata.languageVersion}</div>
					<div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div>
				</div>
			</div>
			{actions}
		</div>
	);
};
