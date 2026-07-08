/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPositronMcpToolService } from '../browser/positronMcpToolService.js';
import { PositronMcpToolService } from '../browser/positronMcpToolService.impl.js';
// Browser-layer UI: config, commands, and status bar (no electron dependency).
import '../browser/positronMcp.contribution.js';
// Registers IPositronMcpService scoped to this window (see positronMcpService.ts).
import './positronMcpService.js';
import { PositronMcpLifecycleContribution } from './positronMcpLifecycleContribution.js';

registerSingleton(IPositronMcpToolService, PositronMcpToolService, InstantiationType.Delayed);
registerWorkbenchContribution2('positronMcpLifecycle', PositronMcpLifecycleContribution, WorkbenchPhase.AfterRestored);
