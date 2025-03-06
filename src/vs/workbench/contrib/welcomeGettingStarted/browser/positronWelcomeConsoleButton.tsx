/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { InterpreterGroups } from '../../../browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups.js';
import { PositronModalPopup } from '../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { ActionButton } from '../../positronNotebook/browser/utilityComponents/ActionButton.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { multipleConsoleSessionsFeatureEnabled } from '../../../services/runtimeSession/common/positronMultipleConsoleSessionsFeatureFlag.js';
import { LANGUAGE_RUNTIME_START_SESSION_ID } from '../../languageRuntime/browser/languageRuntimeActions.js';

interface WelcomeConsoleButtonProps {
	commandService: ICommandService;
	configurationService: IConfigurationService;
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	languageRuntimeService: ILanguageRuntimeService;
	runtimeSessionService: IRuntimeSessionService;
	runtimeStartupService: IRuntimeStartupService;
}

export function WelcomeConsoleButton(props: WelcomeConsoleButtonProps) {
	const multiSessionsEnabled = multipleConsoleSessionsFeatureEnabled(props.configurationService);

	const ref = React.createRef<HTMLDivElement>();
	const showPopup = () => {
		const startRuntime = (runtime: ILanguageRuntimeMetadata) => {
			props.commandService.executeCommand('workbench.action.maximizePanel');
			props.runtimeSessionService.selectRuntime(runtime.runtimeId, 'User-requested startup from the welcome page');
			renderer.dispose();
		};

		const activateRuntime = async (runtime: ILanguageRuntimeMetadata) => {
			const session = props.runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId);

			if (session) {
				props.runtimeSessionService.foregroundSession = session;
				props.commandService.executeCommand('workbench.action.maximizePanel');
				renderer.dispose();
			} else {
				startRuntime(runtime);
			}
		};

		if (ref.current === null) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			keybindingService: props.keybindingService,
			layoutService: props.layoutService,
			container: props.layoutService.getContainer(ref.current.ownerDocument.defaultView!),
			parent: ref.current
		});

		renderer.render(
			<PositronModalPopup
				anchorElement={ref.current}
				height={'auto'}
				keyboardNavigationStyle='menu'
				popupAlignment='left'
				popupPosition='bottom'
				renderer={renderer}
				width={375}
			>
				<InterpreterGroups
					languageRuntimeService={props.languageRuntimeService}
					runtimeAffiliationService={props.runtimeStartupService}
					runtimeSessionService={props.runtimeSessionService}
					onActivateRuntime={activateRuntime}
					onStartRuntime={async (runtime: ILanguageRuntimeMetadata) => {
						startRuntime(runtime);
					}}
				/>
			</PositronModalPopup>
		);
	};

	const handlePressed = () => {
		if (multiSessionsEnabled) {
			props.commandService.executeCommand(LANGUAGE_RUNTIME_START_SESSION_ID);
		} else {
			showPopup();
		}
	}

	// Render.
	return (
		<ActionButton
			ariaLabel={(() => localize('positron.welcome.newConsoleDescription', "Create a new console"))()}
			className='positron-welcome-button'
			onPressed={handlePressed}
		>
			<div ref={ref} className='button-container'>
				<div className={`button-icon codicon codicon-positron-new-console`} />
				<div className='action-label'>
					{(() => localize('positron.welcome.newConsole', "New Console"))()}
				</div>
			</div>
		</ActionButton>
	);
}
