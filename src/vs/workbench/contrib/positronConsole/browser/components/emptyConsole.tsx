/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./emptyConsole';
import * as React from 'react';
import { localize } from 'vs/nls';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { PositronShowStartInterpreterAction } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarActions';

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
