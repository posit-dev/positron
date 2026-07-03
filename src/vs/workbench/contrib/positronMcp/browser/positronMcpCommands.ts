/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IPositronMcpService, POSITRON_MCP_LOG_ID } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOutputService } from '../../../services/output/common/output.js';
import { MCP_ENABLE_KEY } from '../common/positronMcpConfiguration.js';
import { POSITRON_MCP_ACTIVITY_VIEW_ID } from './positronMcpActivityView.js';
import { IPositronMcpToolService } from './positronMcpToolService.js';
import { IMcpStatusData, McpPanelAction, showMcpStatusModal } from './positronMcpStatusModal.js';
import { PositronMcpWorkspace } from './positronMcpWorkspace.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';

const COMMAND_ID = {
	enableServer: 'positron.mcp.enableServer',
	disableServer: 'positron.mcp.disableServer',
	addConfigFile: 'positron.mcp.addConfigFile',
	showStatus: 'positron.mcp.showStatus',
	showLogs: 'positron.mcp.showLogs',
	openAuditLog: 'positron.mcp.openAuditLog',
	resetConsent: 'positron.mcp.resetConsent',
} as const;

const MCP_CATEGORY = localize2('positron.mcp.category', "Positron MCP");

/** Build the live status the panel renders from the current services. */
async function readStatus(accessor: ServicesAccessor): Promise<IMcpStatusData> {
	const configurationService = accessor.get(IConfigurationService);
	const mcpService = accessor.get(IPositronMcpService);
	const toolService = accessor.get(IPositronMcpToolService);
	const workspace = new PositronMcpWorkspace(accessor.get(IFileService), accessor.get(IWorkspaceContextService));

	const enabled = configurationService.getValue<boolean>(MCP_ENABLE_KEY) === true;
	const serverStatus = await mcpService.getStatus();
	const workspaceConfig = await workspace.getConfigState();
	return {
		enabled,
		running: serverStatus.running,
		port: serverStatus.port,
		workspaceConfig,
		sessions: serverStatus.sessions,
		recentActivity: serverStatus.recentActivity,
		allowAllConsent: toolService.isAllowAllConsentActive(),
		auditLogPath: serverStatus.auditLogPath,
	};
}

/** Toggle the enable setting. The lifecycle contribution starts/stops the server in response. */
async function setEnabled(accessor: ServicesAccessor, enabled: boolean): Promise<void> {
	await accessor.get(IConfigurationService).updateValue(MCP_ENABLE_KEY, enabled, ConfigurationTarget.USER);
}

/** Write the workspace `.mcp.json`, notifying the result. */
async function addConfigFile(accessor: ServicesAccessor): Promise<void> {
	const notificationService = accessor.get(INotificationService);
	const workspace = new PositronMcpWorkspace(accessor.get(IFileService), accessor.get(IWorkspaceContextService));
	const path = await workspace.writeMcpConfig();
	if (!path) {
		notificationService.warn(localize('positron.mcp.noWorkspace', "Open a folder or workspace first, then add the .mcp.json file to it."));
		return;
	}
	notificationService.info(localize('positron.mcp.configAdded', "An .mcp.json file in your workspace root now points at the Positron MCP server."));
}

/** Reveal the Positron MCP server log output channel (the server's activity/audit log). */
async function showLogs(accessor: ServicesAccessor): Promise<void> {
	const outputService = accessor.get(IOutputService);
	// The channel only exists once the main-process server has created its logger.
	if (!outputService.getChannel(POSITRON_MCP_LOG_ID)) {
		accessor.get(INotificationService).info(localize('positron.mcp.noLogs', "Server logs appear once the Positron MCP server has started. Enable the server, then try again."));
		return;
	}
	await outputService.showChannel(POSITRON_MCP_LOG_ID);
}

/**
 * Open the JSONL audit file in an editor. The file exists once the server has
 * recorded any audit event (and the detail setting is not 'off'); the panel
 * only shows the button then, so the notification is a fallback for races.
 */
async function openAuditLog(accessor: ServicesAccessor): Promise<void> {
	const mcpService = accessor.get(IPositronMcpService);
	const notificationService = accessor.get(INotificationService);
	const editorService = accessor.get(IEditorService);
	const status = await mcpService.getStatus();
	if (!status.auditLogPath) {
		notificationService.info(localize('positron.mcp.noAuditLog', "The audit log appears once the Positron MCP server has recorded some activity."));
		return;
	}
	await editorService.openEditor({ resource: URI.file(status.auditLogPath) });
}

/** Run a status-panel button by delegating to the matching command. */
async function runPanelAction(accessor: ServicesAccessor, action: McpPanelAction): Promise<void> {
	switch (action.id) {
		case 'enable': return setEnabled(accessor, true);
		case 'disable': return setEnabled(accessor, false);
		case 'addConfig': return addConfigFile(accessor);
		case 'showLogs': return showLogs(accessor);
		case 'openAuditLog': return openAuditLog(accessor);
		// No notification here: the panel's consent banner disappearing is the feedback.
		case 'resetConsent': return accessor.get(IPositronMcpToolService).resetConsent();
	}
}

/** Register the Positron MCP commands. */
export function registerPositronMcpCommands(): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id: COMMAND_ID.enableServer, title: localize2('positron.mcp.enableServer', "Enable Server"), category: MCP_CATEGORY, f1: true });
		}
		run(accessor: ServicesAccessor) { return setEnabled(accessor, true); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: COMMAND_ID.disableServer, title: localize2('positron.mcp.disableServer', "Disable Server"), category: MCP_CATEGORY, f1: true });
		}
		run(accessor: ServicesAccessor) { return setEnabled(accessor, false); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: COMMAND_ID.addConfigFile, title: localize2('positron.mcp.addConfigFile', "Add .mcp.json to Workspace"), category: MCP_CATEGORY, f1: true });
		}
		run(accessor: ServicesAccessor) { return addConfigFile(accessor); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: COMMAND_ID.showStatus, title: localize2('positron.mcp.showStatus', "Show Status"), category: MCP_CATEGORY, f1: true });
		}
		run(accessor: ServicesAccessor) {
			// Capture the instantiation service so the panel's status reads and
			// button actions resolve fresh services each time they run.
			const instantiationService = accessor.get(IInstantiationService);
			const clipboardService = accessor.get(IClipboardService);
			const renderer = new PositronModalReactRenderer();
			showMcpStatusModal(
				renderer,
				() => instantiationService.invokeFunction(readStatus),
				action => instantiationService.invokeFunction(acc => runPanelAction(acc, action)),
				text => clipboardService.writeText(text),
			);
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: COMMAND_ID.showLogs, title: localize2('positron.mcp.showLogs', "Show Logs"), category: MCP_CATEGORY, f1: true });
		}
		run(accessor: ServicesAccessor) { return showLogs(accessor); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: COMMAND_ID.openAuditLog,
				title: localize2('positron.mcp.openAuditLog', "Open Audit Log"),
				category: MCP_CATEGORY,
				f1: true,
				icon: Codicon.output,
				menu: {
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.equals('view', POSITRON_MCP_ACTIVITY_VIEW_ID),
					group: 'navigation',
					order: 1,
				},
			});
		}
		run(accessor: ServicesAccessor) { return openAuditLog(accessor); }
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({ id: COMMAND_ID.resetConsent, title: localize2('positron.mcp.resetConsent', "Reset Code Execution Consent"), category: MCP_CATEGORY, f1: true });
		}
		run(accessor: ServicesAccessor) {
			// The consent dialog's "allow all" option points users here to undo it.
			accessor.get(IPositronMcpToolService).resetConsent();
			accessor.get(INotificationService).info(localize('positron.mcp.consentReset', "Code execution consent has been reset. You will be prompted again the next time an agent runs code."));
		}
	});
}
