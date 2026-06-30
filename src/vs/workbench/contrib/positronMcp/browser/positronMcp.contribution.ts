/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
// Registers the positron.mcp.* configuration as a side effect of import.
import '../common/positronMcpConfiguration.js';
import { registerPositronMcpCommands } from './positronMcpCommands.js';
import { PositronMcpStatusBarContribution } from './positronMcpStatusBar.js';

// Register the MCP commands (enable/disable, .mcp.json, guidance, status, logs).
// Each registration is skipped if the positron-mcp extension already claimed the
// command id, so the two can coexist for a release.
registerPositronMcpCommands();

// Register the status bar entry (hidden unless the server is enabled).
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PositronMcpStatusBarContribution, LifecyclePhase.Restored);
