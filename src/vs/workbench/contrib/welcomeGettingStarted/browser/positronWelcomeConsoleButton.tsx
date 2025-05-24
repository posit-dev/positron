/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ActionButton } from '../../positronNotebook/browser/utilityComponents/ActionButton.js';
import { LANGUAGE_RUNTIME_START_NEW_SESSION_ID } from '../../languageRuntime/browser/languageRuntimeActions.js';

interface WelcomeConsoleButtonProps {
	commandService: ICommandService;
}

export function WelcomeConsoleButton(props: WelcomeConsoleButtonProps) {
	const handlePressed = () => {
		props.commandService.executeCommand(LANGUAGE_RUNTIME_START_NEW_SESSION_ID);
	}

	// Render.
	return (
		<ActionButton
			ariaLabel={(() => localize('positron.welcome.newConsoleDescription', "Create a new console"))()}
			className='positron-welcome-button'
			onPressed={handlePressed}
		>
			<div className='button-container'>
				<div className={`button-icon codicon codicon-positron-new-console`} />
				<div className='action-label'>
					{(() => localize('positron.welcome.newConsole', "New Console"))()}
				</div>
			</div>
		</ActionButton>
	);
}
