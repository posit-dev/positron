/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { McpClient } from './kcclient/api';
import { CONFIGURE_AGENT_COMMAND } from './McpAgentConfig';
import { COPY_MCP_DETAILS_COMMAND, MCP_STATUS_BAR_KEY } from './McpFrontend';
import { agentLabel, agentQuickPickItem, describeClient } from './mcpClients';

/** Command that lists the agents connected to this workspace. */
export const SHOW_CONNECTED_AGENTS_COMMAND = 'positron.mcp.showConnectedAgents';

/** The slice of the MCP frontend the status bar follows. */
export interface McpClientsSource {
	readonly clients: readonly McpClient[];
	readonly onDidChangeClients: vscode.Event<void>;
}

/**
 * The status bar text for a set of connected agents.
 *
 * @param clients The connected clients.
 * @returns The text, or undefined when there is nothing to show.
 */
export function statusBarText(clients: readonly McpClient[]): string | undefined {
	if (clients.length === 0) {
		return undefined;
	}
	const labels = new Set(clients.map(agentLabel));
	if (labels.size === 1) {
		const [label] = labels;
		return clients.length === 1
			? `$(robot) ${label}`
			: `$(robot) ${vscode.l10n.t("{0} ({1})", label, clients.length)}`;
	}
	return `$(robot) ${vscode.l10n.t("{0} Agents", clients.length)}`;
}

/**
 * Shows which coding agents are connected to this workspace's sessions, for
 * users who turn on the `ai.mcp.statusBar` setting. Hidden while none is.
 */
export class McpClientsStatusBar implements vscode.Disposable {
	private readonly _item: vscode.StatusBarItem;

	private readonly _disposables: vscode.Disposable[] = [];

	/**
	 * @param _source The frontend holding the list of connected agents.
	 */
	constructor(private readonly _source: McpClientsSource) {
		this._item = vscode.window.createStatusBarItem(
			'positron.mcp.connectedAgents', vscode.StatusBarAlignment.Right, 100);
		this._item.name = vscode.l10n.t("Connected Coding Agents");
		this._item.command = SHOW_CONNECTED_AGENTS_COMMAND;
		this._disposables.push(this._item);
		this._disposables.push(_source.onDidChangeClients(() => this.update()));
		this._disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(MCP_STATUS_BAR_KEY)) {
				this.update();
			}
		}));
		this.update();
	}

	/** Bring the item in line with the connected agents. */
	private update(): void {
		const clients = this._source.clients;
		const text = statusBarText(clients);
		const enabled = vscode.workspace.getConfiguration().get<boolean>(MCP_STATUS_BAR_KEY) === true;
		if (!text || !enabled) {
			this._item.hide();
			return;
		}
		this._item.text = text;
		const tooltip = new vscode.MarkdownString(
			`${vscode.l10n.t("Coding agents connected to this workspace's sessions:")}\n\n`);
		for (const client of clients) {
			tooltip.appendMarkdown('- ');
			tooltip.appendText(describeClient(client));
			tooltip.appendMarkdown('\n');
		}
		this._item.tooltip = tooltip;
		this._item.show();
	}

	public dispose() {
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables.length = 0;
	}
}

/**
 * Lists the connected agents, with the actions for adding another.
 *
 * @param clients The connected clients.
 */
export async function showConnectedAgents(clients: readonly McpClient[]): Promise<void> {
	type Item = vscode.QuickPickItem & { command?: string };
	const items: Item[] = clients.map(client => agentQuickPickItem(client));
	if (items.length === 0) {
		items.push({ label: vscode.l10n.t("No coding agents are connected") });
	}
	items.push(
		{ label: '', kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(add) ${vscode.l10n.t("Add Positron to a Coding Agent...")}`,
			command: CONFIGURE_AGENT_COMMAND,
		},
		{
			label: `$(copy) ${vscode.l10n.t("Copy MCP Connection Details")}`,
			command: COPY_MCP_DETAILS_COMMAND,
		},
	);

	const choice = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t("Connected Coding Agents"),
		matchOnDescription: true,
		matchOnDetail: true,
	});
	if (choice?.command) {
		await vscode.commands.executeCommand(choice.command);
	}
}
