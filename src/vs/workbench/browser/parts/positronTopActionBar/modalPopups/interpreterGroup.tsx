/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpreterGroup';
import * as React from 'react';
import { KeyboardEvent, MouseEvent, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Interpreter } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreter';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IInterpreterGroup } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterGroups';

/**
 * InterpreterGroupProps interface.
 */
interface InterpreterGroupProps {
	languageRuntimeService: ILanguageRuntimeService;
	interpreterGroup: IInterpreterGroup;
	dismiss: () => void;
}

/**
 * InterpreterGroup component.
 * @param props A InterpreterGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const InterpreterGroup = (props: InterpreterGroupProps) => {
	// State hooks.
	const [all, setAll] = useState(false);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

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
				props.languageRuntimeService.activeRuntime = props.interpreterGroup.primaryRuntime;
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
		props.languageRuntimeService.activeRuntime = props.interpreterGroup.primaryRuntime;
		props.dismiss();
	};

	// /**
	//  * startRuntimeClickHandler event handler.
	//  * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	//  */
	// const startRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
	// 	e.preventDefault();
	// 	e.stopPropagation();
	// 	props.interpreterGroup.primaryRuntime.start();
	// 	//props.dismiss();
	// };

	// /**
	//  * stopRuntimeClick event handler.
	//  * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	//  */
	// const stopRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
	// 	e.preventDefault();
	// 	e.stopPropagation();
	// 	props.interpreterGroup.primaryRuntime.shutdown();
	// };

	// /**
	//  * restartRuntimeClick event handler.
	//  * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	//  */
	// const restartRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
	// 	e.preventDefault();
	// 	e.stopPropagation();
	// 	props.interpreterGroup.primaryRuntime.restart();
	// };

	// /**
	//  * interruptRuntimeClick event handler.
	//  * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	//  */
	// const interruptRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
	// 	e.preventDefault();
	// 	e.stopPropagation();
	// 	props.interpreterGroup.primaryRuntime.interrupt();
	// };

	// switch (runtimeState) {
	// 	case RuntimeState.Uninitialized:
	// 		actions = (
	// 			<div className='actions'>
	// 				<button className='action-button codicon codicon-positron-more-options' title={localize('positronStartTheInterpreter', "Start the interpreter")} onClick={startRuntimeClickHandler} />
	// 				<button className='action-button codicon codicon-positron-power-button' style={{ color: 'green' }} title={localize('positronStartTheInterpreter', "Start the interpreter")} onClick={startRuntimeClickHandler} />
	// 			</div>
	// 		);
	// 		break;

	// 	case RuntimeState.Initializing:
	// 		actions = null;
	// 		break;

	// 	case RuntimeState.Starting:
	// 		actions = null;
	// 		break;

	// 	case RuntimeState.Ready:
	// 	case RuntimeState.Idle:
	// 		actions = (
	// 			<div className='actions'>
	// 				<button className='action-button codicon codicon-positron-restart-runtime' style={{ color: 'green' }} title={localize('positronRestartTheInterpreter', "Restart the interpreter")} onClick={restartRuntimeClickHandler} />
	// 				<button className='action-button codicon codicon-positron-power-button' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
	// 			</div>
	// 		);
	// 		break;

	// 	case RuntimeState.Busy:
	// 		actions = (
	// 			<div className='actions'>
	// 				<button className='action-button codicon codicon-positron-interrupt-runtime' style={{ color: 'red' }} title={localize('positronInterruptTheInterpreter', "Interrupts the interpreter")} onClick={interruptRuntimeClickHandler} />
	// 				<button className='action-button codicon codicon-positron-restart-runtime' style={{ color: 'green' }} title={localize('positronRestartsTheInterpreter', "Restarts the interpreter")} onClick={restartRuntimeClickHandler} />
	// 				<button className='action-button codicon codicon-positron-power-button' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
	// 			</div>
	// 		);
	// 		break;

	// 	case RuntimeState.Exiting:
	// 		actions = (
	// 			<div className='actions'>
	// 				<button className='action-button codicon codicon-positron-power-button' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
	// 			</div>
	// 		);
	// 		break;

	// 	case RuntimeState.Exited:
	// 		actions = (
	// 			<div className='actions'>
	// 				<button className='action-button codicon codicon-positron-power-button' style={{ color: 'green' }} title={localize('positronStartTheInterpreter', "Start the interpreter")} onClick={startRuntimeClickHandler} />
	// 			</div>
	// 		);
	// 		break;

	// 	case RuntimeState.Offline:
	// 		actions = null;
	// 		break;

	// 	case RuntimeState.Interrupting:
	// 		actions = null;
	// 		break;
	// }

	const showAllHandler = () => {
		setAll(!all);
	};

	// Render.
	return (
		<div className='interpreter-group' role='button' tabIndex={0} onKeyDown={runtimeKeyDownHandler} onClick={runtimeClickHandler}>
			<Interpreter languageRuntimeService={props.languageRuntimeService} runtime={props.interpreterGroup.primaryRuntime} primaryRuntime={true} showAll={showAllHandler} dismiss={props.dismiss} />
			{all && props.interpreterGroup.alternateRuntimes.map(x =>
				<Interpreter languageRuntimeService={props.languageRuntimeService} runtime={x} primaryRuntime={false} showAll={showAllHandler} dismiss={props.dismiss} />
			)}
			{/* <img className='icon' src={`data:image/svg+xml;base64,${props.interpreterGroup.primaryRuntime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.interpreterGroup.primaryRuntime.metadata.languageName} {props.interpreterGroup.primaryRuntime.metadata.languageVersion}</div>
					<div className='line light' title={props.interpreterGroup.primaryRuntime.metadata.runtimePath}>{props.interpreterGroup.primaryRuntime.metadata.runtimePath}</div>
				</div>
			</div>
			{actions} */}
		</div>
	);
};
