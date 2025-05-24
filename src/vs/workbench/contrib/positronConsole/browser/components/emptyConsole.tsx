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
import { LANGUAGE_RUNTIME_START_NEW_SESSION_ID } from '../../../languageRuntime/browser/languageRuntimeActions.js';

// Load localized copy for control.
const noSessionRunning = localize('positron.console.empty.noSessionRunning', "There is no session running.");
const useWord = localize('positron.useWord', "Use");
const startSession = localize('positron.console.startSession', "Start Session");
const toStartOne = localize('positron.toStartOne', "to start one.");

/**
 * EmptyConsole component.
 * @returns The rendered component.
 */
export const EmptyConsole = () => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	const handlePressed = () => {
		positronConsoleContext.commandService.executeCommand(LANGUAGE_RUNTIME_START_NEW_SESSION_ID);
	};

	// Render.
	return (
		<div className='empty-console'>
			<div className='title'>
				<span>{noSessionRunning} {useWord} </span>
				<PositronButton className='link' onPressed={handlePressed}>
					{startSession}
				</PositronButton>
				<span> {toStartOne}</span>
			</div>
		</div>
	);
};
