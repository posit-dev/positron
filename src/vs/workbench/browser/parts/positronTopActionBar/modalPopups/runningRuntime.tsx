/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runningRuntime';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * RunningRuntimeProps interface.
 */
interface RunningRuntimeProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	dismiss: () => void;
}

/**
 * RunningRuntime component.
 * @param props A LanguageSelectorProps that contains the component properties.
 * @returns The rendered component.
 */
export const RunningRuntime = (props: RunningRuntimeProps) => {

	/**
	 * runtimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const runtimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.languageRuntimeService.activeRuntime = props.runtime;
		props.dismiss();
	};

	/**
	 * stopRuntimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const stopRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.shutdown();
		props.dismiss();
	};

	/**
	 * restartRuntimeClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const restartRuntimeClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.runtime.restart();
		props.dismiss();
	};

	// Render.
	return (
		<button className='running-runtime' onClick={runtimeClickHandler}>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} style={{ width: 60, height: 60 }} />

			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageName} {props.runtime.metadata.languageVersion}</div>
					<div className='line light' title={props.runtime.metadata.kernelPath}>{props.runtime.metadata.kernelPath}</div>
					<div className='line'>change...</div>
				</div>
			</div>

			<div className='actions'>
				<button className='action-button codicon codicon-positron-stop-runtime' style={{ color: 'red' }} title={localize('positronStopsTheInterpreter', "Stops the interpreter")} onClick={stopRuntimeClickHandler} />
				<button className='action-button codicon codicon-positron-restart-runtime' style={{ color: 'green' }} title={localize('positronRestartsTheInterpreter', "Restarts the interpreter")} onClick={restartRuntimeClickHandler} />
			</div>
		</button>
	);
};
