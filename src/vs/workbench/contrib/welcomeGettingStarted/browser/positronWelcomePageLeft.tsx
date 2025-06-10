/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './media/positronGettingStarted.css';

// React.
import React from 'react';

// Other dependencies.
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { PositronWelcomePageStart } from './positronWelcomePageStart.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const createWelcomePageLeft = (
	container: HTMLElement,
	commandService: ICommandService,
	configurationService: IConfigurationService,
	keybindingService: IKeybindingService,
	layoutService: ILayoutService
): PositronReactRenderer => {
	const renderer = new PositronReactRenderer(container);
	renderer.render(
		<PositronWelcomePageStart
			commandService={commandService}
			configurationService={configurationService}
			keybindingService={keybindingService}
			layoutService={layoutService}
		/>
	);
	return renderer;
};
