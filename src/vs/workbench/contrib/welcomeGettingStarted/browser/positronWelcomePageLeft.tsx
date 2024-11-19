/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./media/positronGettingStarted';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
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

export interface PositronWelcomePageLeftProps {
	openerService: IOpenerService;
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	commandService: ICommandService;
	runtimesSessionService: IRuntimeSessionService;
	languageRuntimeService: ILanguageRuntimeService;
	runtimeStartupService: IRuntimeStartupService;
}

export const PositronWelcomePageLeft = (props: PropsWithChildren<PositronWelcomePageLeftProps>) => {
	// Render.
	return (
		<>
			<PositronWelcomePageStart
				keybindingService={props.keybindingService}
				layoutService={props.layoutService}
				commandService={props.commandService}
				runtimeSessionService={props.runtimesSessionService}
				runtimeStartupService={props.runtimeStartupService}
				languageRuntimeService={props.languageRuntimeService}
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
	runtimeSessionService: IRuntimeSessionService,
	runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService
): PositronReactRenderer => {
	const renderer = new PositronReactRenderer(container);
	renderer.render(
		<PositronWelcomePageLeft
			openerService={openerService}
			keybindingService={keybindingService}
			layoutService={layoutService}
			commandService={commandService}
			runtimesSessionService={runtimeSessionService}
			runtimeStartupService={runtimeStartupService}
			languageRuntimeService={languageRuntimeService}
		/>
	);
	return renderer;
};
