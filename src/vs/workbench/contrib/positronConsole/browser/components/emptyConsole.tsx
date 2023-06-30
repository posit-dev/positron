/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./emptyConsole';
import * as React from 'react';
import { localize } from 'vs/nls';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { PositronShowStartInterpreterAction } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarActions';

const a = localize('noInterpreterRunning', "There is no interpreter running.");
const b = localize('useWord', "Use");
const c = localize('startInterpreter', "Start Interpreter");
const d = localize('toStartOne', "to start one.");

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
				<span>{a} {b} </span>
				<PositronButton className='link' onClick={startInterpreterClickHandler}>
					{c}
				</PositronButton>
				<span> {d}</span>
			</div>
		</div>
	);
};
