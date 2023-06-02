/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./primaryInterpreter';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterActions';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PrimaryInterpreterProps interface.
 */
interface PrimaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	enableShowAllVersions: boolean;
	onShowAllVersions: () => void;
	onStart: () => void;
	onActivate: () => void;
}

/**
 * PrimaryInterpreter component.
 * @param props A PrimaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const PrimaryInterpreter = (props: PrimaryInterpreterProps) => {
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


	// Render.
	return (
		<div className='primary-interpreter' role='button' tabIndex={0} onClick={clickHandler}>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageName} {props.runtime.metadata.languageVersion}</div>
					<div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions runtime={props.runtime} onStart={props.onStart}>
				{props.enableShowAllVersions &&
					<button
						className='action-button codicon codicon-positron-more-options'
						title={localize('positronShowAllVersions', "Show all versions")}
						onClick={showAllVersionsClickHandler}
					/>
				}
			</InterpreterActions>
		</div>
	);
};
