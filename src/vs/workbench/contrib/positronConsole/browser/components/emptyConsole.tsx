/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './emptyConsole.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { PositronShowStartInterpreterAction } from '../../../../browser/parts/positronTopActionBar/positronTopActionBarActions.js';

// Load localized copy for control.
const noInterpreterRunning = localize('positron.noInterpreterRunning', "There is no interpreter running.");
const useWord = localize('positron.useWord', "Use");
const startInterpreter = localize('positron.startInterpreter', "Start Interpreter");
const toStartOne = localize('positron.toStartOne', "to start one.");

/**
 * EmptyConsole component.
 * @returns The rendered component.
 */
export const EmptyConsole = () => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	/**
	 * The start interpreter click handler.
	 */
	const startInterpreterClickHandler = () => {
		positronConsoleContext.commandService.executeCommand(PositronShowStartInterpreterAction.ID);
	};

	// Render.
	return (
		<div className='empty-console'>
			<div className='title'>
				<span>{noInterpreterRunning} {useWord} </span>
				<PositronButton className='link' onPressed={startInterpreterClickHandler}>
					{startInterpreter}
				</PositronButton>
				<span> {toStartOne}</span>
			</div>
		</div>
	);
};
