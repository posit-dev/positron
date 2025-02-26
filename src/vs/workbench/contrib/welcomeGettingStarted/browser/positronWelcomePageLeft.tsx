/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './media/positronGettingStarted.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { PositronWelcomePageStart } from './positronWelcomePageStart.js';
import { PositronWelcomePageHelp } from './positronWelcomePageHelp.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export interface PositronWelcomePageLeftProps {
	openerService: IOpenerService;
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	commandService: ICommandService;
	configurationService: IConfigurationService;
	runtimesSessionService: IRuntimeSessionService;
	languageRuntimeService: ILanguageRuntimeService;
	runtimeStartupService: IRuntimeStartupService;
}

export const PositronWelcomePageLeft = (props: PropsWithChildren<PositronWelcomePageLeftProps>) => {
	// Render.
	return (
		<>
			<PositronWelcomePageStart
				commandService={props.commandService}
				configurationService={props.configurationService}
				keybindingService={props.keybindingService}
				languageRuntimeService={props.languageRuntimeService}
				layoutService={props.layoutService}
				runtimeSessionService={props.runtimesSessionService}
				runtimeStartupService={props.runtimeStartupService}
			/>
			<PositronWelcomePageHelp openerService={props.openerService} />
		</>
	);
};

export const createWelcomePageLeft = (
	container: HTMLElement,
	openerService: IOpenerService,
	keybindingService: IKeybindingService,
	layoutService: ILayoutService,
	commandService: ICommandService,
	configurationService: IConfigurationService,
	runtimeSessionService: IRuntimeSessionService,
	runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService
): PositronReactRenderer => {
	const renderer = new PositronReactRenderer(container);
	renderer.render(
		<PositronWelcomePageLeft
			commandService={commandService}
			configurationService={configurationService}
			keybindingService={keybindingService}
			languageRuntimeService={languageRuntimeService}
			layoutService={layoutService}
			openerService={openerService}
			runtimeStartupService={runtimeStartupService}
			runtimesSessionService={runtimeSessionService}
		/>
	);
	return renderer;
};
