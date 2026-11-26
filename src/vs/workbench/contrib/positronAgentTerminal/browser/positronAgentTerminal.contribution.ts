/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPositronAgentTerminalService } from '../common/agentTerminalService.js';
import { PositronAgentTerminalService } from './agentTerminalService.js';

registerSingleton(IPositronAgentTerminalService, PositronAgentTerminalService, InstantiationType.Delayed);

/** Starts the service with the workbench, so it takes back agent terminals reattached after a window reload. */
class PositronAgentTerminalContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronAgentTerminal';

	constructor(@IPositronAgentTerminalService _agentTerminalService: IPositronAgentTerminalService) { }
}

registerWorkbenchContribution2(PositronAgentTerminalContribution.ID, PositronAgentTerminalContribution, WorkbenchPhase.BlockStartup);
