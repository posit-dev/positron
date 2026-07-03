/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
// Also registers the positron.mcp.* configuration as a side effect of import.
import { MCP_ENABLE_KEY } from '../common/positronMcpConfiguration.js';
import { POSITRON_MCP_ACTIVITY_VIEW_ID, PositronMcpActivityViewPane } from './positronMcpActivityView.js';
import { registerPositronMcpCommands } from './positronMcpCommands.js';
import { PositronMcpStatusBarContribution } from './positronMcpStatusBar.js';

// Register the MCP commands (enable/disable, .mcp.json, status, logs,
// audit log, consent reset).
registerPositronMcpCommands();

// Register the status bar entry (hidden unless the server is enabled).
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PositronMcpStatusBarContribution, LifecyclePhase.Restored);

// --- The MCP Activity view ---

const positronMcpActivityViewIcon = registerIcon(
	'positron-mcp-activity-view-icon',
	Codicon.plug,
	localize('positron.mcp.activity.viewIcon', "View icon of the MCP Activity view.")
);

/**
 * The pane is AI UI gated behind the MCP opt-in: it only shows while the AI
 * main switch is on AND the MCP server is enabled. Both settings toggle
 * without a reload, so the view appears/disappears live.
 */
const MCP_ACTIVITY_WHEN = ContextKeyExpr.and(
	ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
	ContextKeyExpr.has(`config.${MCP_ENABLE_KEY}`),
);

// A dedicated auxiliary-bar container (like Connections); hideIfEmpty hides
// the container icon whenever the when clause hides the only view.
const MCP_ACTIVITY_VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(
	{
		id: POSITRON_MCP_ACTIVITY_VIEW_ID,
		title: {
			value: localize('positron.mcp.activity.title', "MCP Activity"),
			original: 'MCP Activity'
		},
		icon: positronMcpActivityViewIcon,
		order: 10,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_MCP_ACTIVITY_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_MCP_ACTIVITY_VIEW_ID,
		hideIfEmpty: true,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_MCP_ACTIVITY_VIEW_ID,
	name: {
		value: localize('positron.mcp.activity.viewName', "MCP Activity"),
		original: 'MCP Activity'
	},
	containerIcon: positronMcpActivityViewIcon,
	canMoveView: true,
	canToggleVisibility: true,
	when: MCP_ACTIVITY_WHEN,
	ctorDescriptor: new SyncDescriptor(PositronMcpActivityViewPane),
}], MCP_ACTIVITY_VIEW_CONTAINER);
