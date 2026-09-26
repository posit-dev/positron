/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { McpClient } from './kcclient/api';
import { MCP_AGENTS } from './McpAgents';

/**
 * The name to show for an agent. Agents report a name of their own choosing,
 * such as `claude-code` or `codex-mcp-client`, so the harnesses Positron knows
 * are shown under their proper names.
 *
 * @param client The agent, as a connected client or an execution's
 *  attribution names it.
 * @returns The agent's name, fit to show the user.
 */
export function agentLabel(client: Pick<McpClient, 'name'>): string {
	const name = client.name;
	if (!name) {
		return vscode.l10n.t("Unknown agent");
	}
	const known = MCP_AGENTS.find(agent => name === agent.id || name.startsWith(`${agent.id}-`));
	return known?.label ?? name;
}

/**
 * One line describing a client, for the log.
 *
 * @param client The connected client.
 * @returns The agent's name and version, and where it is running.
 */
export function describeClient(client: McpClient): string {
	const name = client.version ? `${agentLabel(client)} ${client.version}` : agentLabel(client);
	const where = [
		client.pid !== undefined ? `pid ${client.pid}` : undefined,
		client.working_directory,
	].filter(part => part !== undefined);
	return where.length > 0 ? `${name} (${where.join(', ')})` : name;
}

/**
 * A Quick Pick entry describing a connected client.
 *
 * @param client The connected client.
 * @param workspaceName The workspace it is connected to, when the list spans
 *  more than one.
 * @returns The entry.
 */
export function agentQuickPickItem(client: McpClient, workspaceName?: string): vscode.QuickPickItem {
	return {
		label: `$(robot) ${agentLabel(client)}`,
		description: [client.version, workspaceName].filter(part => part).join(' • ') || undefined,
		detail: [
			client.working_directory,
			client.session_id
				? vscode.l10n.t("inside session {0}", client.session_id)
				: undefined,
			vscode.l10n.t("connected at {0}", new Date(client.connected_at).toLocaleTimeString()),
		].filter(part => part !== undefined).join(' • '),
	};
}
