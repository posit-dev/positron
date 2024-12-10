/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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

interface WelcomeConsoleButtonProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	languageRuntimeService: ILanguageRuntimeService;
	runtimeSessionService: IRuntimeSessionService;
	runtimeStartupService: IRuntimeStartupService;
	commandService: ICommandService;
}

export function WelcomeConsoleButton(props: WelcomeConsoleButtonProps) {
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
				renderer={renderer}
				anchorElement={ref.current}
				popupPosition='bottom'
				popupAlignment='left'
				width={375}
				height={'min-content'}
				keyboardNavigationStyle='menu'
			>
				<InterpreterGroups
					languageRuntimeService={props.languageRuntimeService}
					runtimeSessionService={props.runtimeSessionService}
					runtimeAffiliationService={props.runtimeStartupService}
					onActivateRuntime={activateRuntime}
					onStartRuntime={async (runtime: ILanguageRuntimeMetadata) => {
						startRuntime(runtime);
					}}
				/>
			</PositronModalPopup>
		);
	};

	// Render.
	return (
		<ActionButton
			className='positron-welcome-button'
			ariaLabel={(() => localize('positron.welcome.newConsoleDescription', "Create a new console"))()}
			onPressed={showPopup}
		>
			<div className='button-container' ref={ref}>
				<div className={`button-icon codicon codicon-positron-new-console`} />
				<div className='action-label'>
					{(() => localize('positron.welcome.newConsole', "New Console"))()}
				</div>
			</div>
		</ActionButton>
	);
}
