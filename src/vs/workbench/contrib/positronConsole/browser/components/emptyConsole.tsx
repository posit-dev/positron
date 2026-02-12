/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './emptyConsole.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { LANGUAGE_RUNTIME_START_NEW_SESSION_ID } from '../../../languageRuntime/browser/languageRuntimeActions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

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
	const services = usePositronReactServicesContext();

	const handlePressed = () => {
		services.commandService.executeCommand(LANGUAGE_RUNTIME_START_NEW_SESSION_ID);
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
