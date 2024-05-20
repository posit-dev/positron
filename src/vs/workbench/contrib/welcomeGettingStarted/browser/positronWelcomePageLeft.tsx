/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./media/positronGettingStarted';

// React.
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { PositronWelcomePageStart } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomePageStart';
import { PositronWelcomePageHelp } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomePageHelp';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { projectWizardEnabled } from 'vs/workbench/services/positronNewProject/common/positronNewProjectEnablement';

export interface PositronWelcomePageLeftProps {
	openerService: IOpenerService;
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	commandService: ICommandService;
	runtimesSessionService: IRuntimeSessionService;
	languageRuntimeService: ILanguageRuntimeService;
	runtimeStartupService: IRuntimeStartupService;
	projectWizardEnabled: boolean;
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
				projectWizardEnabled={props.projectWizardEnabled}
			/>
			<PositronWelcomePageHelp openerService={props.openerService} />
		</>
	);
};

export const createWelcomePageLeft = (container: HTMLElement, openerService: IOpenerService,
	keybindingService: IKeybindingService, layoutService: ILayoutService, commandService: ICommandService,
	runtimeSessionService: IRuntimeSessionService, runtimeStartupService: IRuntimeStartupService,
	languageRuntimeService: ILanguageRuntimeService, contextKeyService: IContextKeyService, configurationService: IConfigurationService): PositronReactRenderer => {
	const enableProjectWizard = projectWizardEnabled(contextKeyService, configurationService);
	const renderer = new PositronReactRenderer(container);
	renderer.render(<PositronWelcomePageLeft
		openerService={openerService}
		keybindingService={keybindingService}
		layoutService={layoutService}
		commandService={commandService}
		runtimesSessionService={runtimeSessionService}
		runtimeStartupService={runtimeStartupService}
		languageRuntimeService={languageRuntimeService}
		projectWizardEnabled={enableProjectWizard}
	/>);
	return renderer;
};
