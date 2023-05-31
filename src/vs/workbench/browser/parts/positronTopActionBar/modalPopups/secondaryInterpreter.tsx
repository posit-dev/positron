/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./secondaryInterpreter';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterActions';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * SecondaryInterpreterProps interface.
 */
interface SecondaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	onStart: () => void;
	onActivate: () => void;
}

/**
 * SecondaryInterpreter component.
 * @param props A SecondaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const SecondaryInterpreter = (props: SecondaryInterpreterProps) => {
	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLButtonElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Activate the runtime.
		props.onActivate();
	};

	// Render.
	return (
		<div className='secondary-interpreter' role='button' tabIndex={0} onClick={clickHandler}>
			<div></div>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageVersion}</div>
					<div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions
				runtime={props.runtime}
				isPrimaryRuntime={false}
				onStart={props.onStart}
			/>
		</div>
	);
};
