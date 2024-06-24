/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { InterpreterGroups } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';

import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

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
