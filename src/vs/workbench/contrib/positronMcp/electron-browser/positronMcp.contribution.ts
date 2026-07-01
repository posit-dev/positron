/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-browser/services.js';
import { IPositronMcpService, PositronMcpChannelName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPositronMcpToolService } from '../browser/positronMcpToolService.js';
import { PositronMcpToolService } from '../browser/positronMcpToolService.impl.js';
// Browser-layer UI: config, commands, and status bar (no electron dependency).
import '../browser/positronMcp.contribution.js';
import { PositronMcpLifecycleContribution } from './positronMcpLifecycleContribution.js';

// Expose the main-process MCP server to the renderer so the lifecycle driver and
// the status UI can drive it and read its status through DI.
registerMainProcessRemoteService(IPositronMcpService, PositronMcpChannelName);
registerSingleton(IPositronMcpToolService, PositronMcpToolService, InstantiationType.Delayed);
registerWorkbenchContribution2('positronMcpLifecycle', PositronMcpLifecycleContribution, WorkbenchPhase.AfterRestored);
