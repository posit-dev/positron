/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { McpClient, McpWorkspace, McpWorkspaceRegistration, McpStatus } from './kcclient/api';
import { McpFrontendChannel } from './McpFrontendChannel';
import { describeClient } from './mcpClients';
import {
	MCP_TOKEN_ENV_VAR,
	MCP_URL_ENV_VAR,
	McpConnection,
	mcpDescriptorPath,
	removeConnectionFiles,
	writeConnectionFiles,
} from './mcpConnection';
import { summarizeError } from './util';

// The `ai.*` settings below are registered by Positron core, in
// `positronAIConfigurationKeys.ts`; the extension host cannot import from
// `src/vs`, so the keys are repeated here.

/** The main AI switch; when off, no AI feature may run. */
export const AI_ENABLED_KEY = 'ai.enabled';

/** Whether this window offers its sessions and commands to external agents. */
export const MCP_ENABLED_KEY = 'ai.mcp.enabled';

/** Whether the status bar shows the connected coding agents. */
export const MCP_STATUS_BAR_KEY = 'ai.mcp.statusBar';

/** Command that puts the MCP endpoint and token on the clipboard. */
export const COPY_MCP_DETAILS_COMMAND = 'positron.mcp.copyConnectionDetails';

/** Where a workspace's MCP identity is kept. */
const MCP_STATE_KEY = 'positron-supervisor.mcp.workspace';

/**
 * What is remembered between registrations, so that a re-registered workspace
 * keeps the endpoint URL and token agents are configured with.
 *
 * The supervisor keeps none of this: its workspace registry lives in memory, so
 * everything an agent's configuration depends on has to outlive the process
 * that issued it, or every supervisor restart hands agents a URL that no longer
 * resolves and a token that no longer authenticates.
 */
export interface McpFrontendState {
	/**
	 * The workspace ID the supervisor issued. Giving a new server the same ID
	 * back means the endpoint URL does not move.
	 */
	workspaceId?: string;

	/**
	 * The port the listener was last bound to, asked for again so that a
	 * hand-configured agent's URL survives a supervisor restart.
	 */
	port?: number;

	/**
	 * The bearer token the supervisor issued. Handed back on every
	 * registration, which is what keeps an agent configured with it working
	 * after the supervisor it was issued by has gone.
	 */
	token?: string;
}

/**
 * Read the MCP identity saved for this workspace.
 *
 * It lives in workspace state rather than beside the supervisor's own state,
 * because an agent's configuration outlives any one supervisor process: the
 * same place holds the supervisor's own bearer token, for the same reason.
 *
 * @param memento The workspace state.
 */
export function loadMcpState(memento: vscode.Memento): McpFrontendState {
	return memento.get<McpFrontendState>(MCP_STATE_KEY) ?? {};
}

/**
 * Persist the MCP identity for this workspace.
 *
 * @param memento The workspace state.
 * @param state The identity to save.
 */
export function saveMcpState(memento: vscode.Memento, state: McpFrontendState): Thenable<void> {
	return memento.update(MCP_STATE_KEY, state);
}

/**
 * The slice of {@link vscode.GlobalEnvironmentVariableCollection} the frontend
 * writes to, so tests can supply a collection without the whole surface.
 */
export interface McpTerminalEnvironment {
	description: string | vscode.MarkdownString | undefined;
	replace(variable: string, value: string): void;
	clear(): void;
}

/** The slice of the supervisor API the frontend calls. */
export interface McpRegistrationApi {
	registerMcpWorkspace(registration: McpWorkspaceRegistration): Promise<{ data: McpWorkspace }>;
	deregisterMcpWorkspace(workspaceId: string): Promise<unknown>;
}

/**
 * How to reach a registered frontend's channel: the WebSocket URI and the
 * headers carrying the supervisor API token. Supplied by the caller, which
 * knows the transport in use.
 */
export interface McpChannelTarget {
	uri: string;
	headers: { [key: string]: string };
}

/**
 * Registers this window's workspace with the supervisor's MCP server so
 * external coding agents can reach its sessions, and publishes the resulting
 * endpoint and token into integrated terminals.
 *
 * Registration follows the supervisor's lifecycle: {@link attach} is called
 * whenever the supervisor starts or is reconnected to, and settings changes are
 * applied live. Disconnecting from the supervisor deliberately does *not*
 * deregister, so an agent running in a terminal keeps working after the window
 * closes; only turning the feature off does.
 */
export class McpFrontend implements vscode.Disposable {
	/** The current registration, when the feature is on and the server is up. */
	private _connection: McpConnection | undefined;

	/** Fires when {@link connection} is issued, replaced, or given up. */
	private readonly _onDidChangeConnection = new vscode.EventEmitter<void>();

	/** The agents connected to this workspace, as the supervisor last said. */
	private _clients: McpClient[] = [];

	/** Fires when {@link clients} changes. */
	private readonly _onDidChangeClients = new vscode.EventEmitter<void>();

	/** The supervisor API, once a supervisor is available. */
	private _api: McpRegistrationApi | undefined;

	/** Serializes syncs so overlapping settings changes can't race. */
	private _syncing: Promise<void> = Promise.resolve();

	/**
	 * Serializes the registration hooks, which both rewrite the list of
	 * configured agents, without holding up syncs on the agent CLIs they run.
	 */
	private _hooks: Promise<void> = Promise.resolve();

	/** Resolves the channel target for a registered workspace. */
	private _channelTarget: ((workspaceId: string) => McpChannelTarget) | undefined;

	/** The channel over which we broker commands, while registered. */
	private _channel: McpFrontendChannel | undefined;

	private readonly _disposables: vscode.Disposable[] = [];

	/**
	 * @param _environment The terminal environment collection to publish into.
	 * @param _log Writes a line to the Kernel Supervisor output channel.
	 * @param _loadState Reads the state left by a previous registration.
	 * @param _saveState Persists the state for the next registration.
	 * @param _sessionIds The sessions this window holds. With the sessions it
	 *  created, these are the only ones agents attached to the workspace may
	 *  reach.
	 * @param _enabled Whether the feature is turned on. Read on every sync
	 *  rather than cached, since both switches apply without a reload and
	 *  `ai.enabled` can be enforced by a Workbench administrator at any time.
	 * @param _onRegistered Called with the registration once the endpoint is
	 *  live, for work that should not point agents at a listener that does not
	 *  exist yet.
	 * @param _onDeregistered Called once the endpoint is gone, for work that
	 *  should not outlive it -- the entries agents were configured with, which
	 *  name an endpoint that no longer answers.
	 * @param _processEnv The extension host's environment, which the agents
	 *  extensions spawn inherit.
	 * @param _storageUri The extension's global storage, where the connection
	 *  files agents that cannot read an environment are pointed at are kept.
	 */
	constructor(
		private readonly _storageUri: vscode.Uri,
		private readonly _environment: McpTerminalEnvironment,
		private readonly _log: (message: string) => void,
		private readonly _loadState: () => McpFrontendState,
		private readonly _saveState: (state: McpFrontendState) => Thenable<void>,
		private readonly _sessionIds: () => string[],
		private readonly _enabled: () => boolean = mcpFeatureEnabled,
		private readonly _onRegistered: (connection: McpConnection) => void | Thenable<void> = () => { },
		private readonly _onDeregistered: () => void | Thenable<void> = () => { },
		private readonly _processEnv: NodeJS.ProcessEnv = process.env,
	) {
		this._disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(AI_ENABLED_KEY) ||
				event.affectsConfiguration(MCP_ENABLED_KEY)) {
				this.sync();
			}
		}));
		this._disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() =>
			this.updateConnectionFiles()));
		this._disposables.push(vscode.window.onDidChangeWindowState(state => {
			if (state.focused) {
				this.updateConnectionFiles();
			}
		}));
	}

	/**
	 * The current registration, or undefined when the feature is off or no
	 * supervisor is available.
	 */
	public get connection(): McpConnection | undefined {
		return this._connection;
	}

	/**
	 * Fires whenever {@link connection} changes, so that anything publishing the
	 * endpoint elsewhere -- the MCP server definition provider, say -- can
	 * follow it.
	 */
	public readonly onDidChangeConnection: vscode.Event<void> = this._onDidChangeConnection.event;

	/**
	 * The agents connected to this workspace through the stdio bridge, oldest
	 * first. Empty while the frontend channel is closed.
	 */
	public get clients(): readonly McpClient[] {
		return this._clients;
	}

	/** Fires whenever {@link clients} changes. */
	public readonly onDidChangeClients: vscode.Event<void> = this._onDidChangeClients.event;

	/**
	 * Point the frontend at a supervisor that has just started or been
	 * reconnected to, and bring registration in line with the settings.
	 *
	 * @param api The API of the supervisor now serving this window.
	 * @param channelTarget Resolves the frontend channel's WebSocket URI and
	 *  headers, once a workspace ID has been issued.
	 */
	public async attach(
		api: McpRegistrationApi,
		channelTarget?: (workspaceId: string) => McpChannelTarget,
	): Promise<void> {
		// Queued behind any sync in flight, so a registration with the old
		// server can't land after this reset and stand in for the new one.
		this._syncing = this._syncing.then(() => {
			this._api = api;
			this._channelTarget = channelTarget;
			// A new server process means a new (empty) workspace registry, so
			// the registration we may have been holding no longer exists there.
			this.closeChannel();
			this.setConnection(undefined);
		});
		await this.sync();
	}

	/**
	 * Bring registration in line with the current settings: register when the
	 * feature is on and we aren't registered, deregister when it is off.
	 *
	 * @returns A promise that resolves when the registration is up to date.
	 */
	public sync(): Promise<void> {
		this._syncing = this._syncing.then(() => this.syncNow()).catch(err => {
			this._log(`Failed to update MCP registration: ${summarizeError(err)}`);
		});
		return this._syncing;
	}

	/**
	 * Describes the MCP server for the running-supervisors Quick Pick.
	 *
	 * @param status The `mcp` block of the supervisor's status, if it reports one.
	 * @returns A display string, or undefined when the server is too old to know
	 *  about MCP.
	 */
	public static describeStatus(status: McpStatus | undefined): string | undefined {
		if (!status) {
			return undefined;
		}
		if (!status.active) {
			return vscode.l10n.t("MCP: off");
		}
		const connected = status.workspaces
			.reduce((count, workspace) => count + (workspace.clients?.length ?? 0), 0);
		if (connected === 1) {
			return vscode.l10n.t(
				"MCP: 127.0.0.1:{0} • {1} agent requests • 1 agent connected",
				status.port,
				status.request_count);
		}
		if (connected > 1) {
			return vscode.l10n.t(
				"MCP: 127.0.0.1:{0} • {1} agent requests • {2} agents connected",
				status.port,
				status.request_count,
				connected);
		}
		return vscode.l10n.t(
			"MCP: 127.0.0.1:{0} • {1} agent requests",
			status.port,
			status.request_count);
	}

	/**
	 * Tell the supervisor which sessions this window holds, so agents attached
	 * to it reach those and no others.
	 *
	 * Sessions this window starts name it as they are created, so this is what
	 * covers the rest: sessions that were already running when the user turned
	 * MCP on. Does nothing when the channel is closed; the supervisor keeps the
	 * last set it was told, and we send a fresh one as soon as we reconnect.
	 */
	public notifySessionsChanged(): void {
		this._channel?.sessionsChanged();
	}

	/**
	 * Put the endpoint and token on the clipboard as shell exports, for agents
	 * launched from a terminal Positron did not open.
	 */
	public async copyConnectionDetails(): Promise<void> {
		if (!this._connection) {
			await vscode.window.showWarningMessage(vscode.l10n.t(
				"Positron's MCP server is not running. Turn on the '{0}' setting to start it.",
				MCP_ENABLED_KEY));
			return;
		}
		await vscode.env.clipboard.writeText(
			`export ${MCP_URL_ENV_VAR}=${this._connection.url}\n` +
			`export ${MCP_TOKEN_ENV_VAR}=${this._connection.token}\n`);
		await vscode.window.showInformationMessage(vscode.l10n.t(
			"Copied the MCP connection details for {0}. Treat the token like a password: it lets an agent run code in this workspace's sessions.",
			this._connection.url));
	}

	public dispose() {
		this.closeChannel();
		this._onDidChangeConnection.dispose();
		this._onDidChangeClients.dispose();
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables.length = 0;
	}

	/**
	 * Replace the current registration and announce it.
	 *
	 * @param connection The new registration, or undefined when giving one up.
	 */
	private setConnection(connection: McpConnection | undefined): void {
		if (this._connection === connection) {
			return;
		}
		this._connection = connection;
		this._onDidChangeConnection.fire();
	}

	/** The body of {@link sync}, run one at a time. */
	private async syncNow(): Promise<void> {
		if (!this._api) {
			return;
		}
		if (!this._enabled()) {
			await this.deregister();
			return;
		}
		if (!this._connection) {
			await this.register();
		}
	}

	/**
	 * Register with the supervisor and publish the result to terminals.
	 *
	 * The display name is the workspace's, and the supervisor builds the
	 * workspace ID out of it, so the URL agents are configured with names the
	 * folder the user has open.
	 */
	private async register(): Promise<void> {
		const displayName = vscode.workspace.name ?? vscode.l10n.t("Empty Workspace");
		const saved = this._loadState();
		const response = await this._api!.registerMcpWorkspace({
			workspace_id: saved.workspaceId,
			display_name: displayName,
			preferred_port: saved.port,
			// Asking to keep the token we already have is what makes the
			// endpoint's credential survive a supervisor restart. A server too
			// old to understand the field, or one that finds it malformed,
			// issues a token of its own and we adopt that instead.
			token: saved.token,
		});

		const { workspace_id: workspaceId, token, port, url } = response.data;
		const connection: McpConnection = {
			workspaceId, displayName, token, port, url, folders: workspaceFolderPaths(),
		};
		this.setConnection(connection);
		await this._saveState({ workspaceId, port, token });
		await this.publishEnvironment(connection);
		this._log(`Registered MCP workspace ${workspaceId}; agents can connect at ${url}, ` +
			`or read ${mcpDescriptorPath(this._storageUri, workspaceId)}`);
		this.openChannel(workspaceId);
		this.runHook(() => this._onRegistered(connection));
	}

	/**
	 * Republish the connection files when folders are added to or removed from
	 * the workspace, since the stdio bridge finds a workspace by its folders,
	 * and when the window takes focus, since the bridge prefers the workspace
	 * used most recently when two list the same folder.
	 */
	private async updateConnectionFiles(): Promise<void> {
		if (!this._connection) {
			return;
		}
		this._connection.folders = workspaceFolderPaths();
		try {
			await writeConnectionFiles(this._storageUri, this._connection);
		} catch (err) {
			this._log(`Could not update the MCP connection files: ${summarizeError(err)}`);
		}
	}

	/**
	 * Deregister, invalidating our token and closing the listener.
	 *
	 * Runs whenever a sync finds the feature off, not only when we hold a
	 * registration: the terminal environment collection is persisted by the
	 * workbench, so it has to be cleared even if the feature was already off
	 * when this window started.
	 */
	private async deregister(): Promise<void> {
		const connection = this._connection;
		this.setConnection(undefined);
		this.closeChannel();
		await this.clearEnvironment(connection);
		this.runHook(() => this._onDeregistered());
		// The saved identity is left alone: deregistration drops the workspace
		// from the supervisor, but turning the feature back on should hand
		// agents the URL and token they were already configured with.
		if (!connection) {
			return;
		}
		await this._api!.deregisterMcpWorkspace(connection.workspaceId);
		this._log(`Deregistered MCP workspace ${connection.workspaceId}`);
	}

	/**
	 * Open the channel that carries this window's command catalog to the
	 * supervisor and agents' command requests back.
	 *
	 * @param workspaceId The ID the supervisor issued at registration.
	 */
	private openChannel(workspaceId: string): void {
		if (!this._channelTarget) {
			return;
		}
		try {
			const target = this._channelTarget(workspaceId);
			this._channel = new McpFrontendChannel(
				target.uri, target.headers, this._log, this._sessionIds,
				clients => this.setClients(clients));
		} catch (err) {
			// The registration itself is live, so let it stand; only the
			// command catalog and agents' command requests are lost.
			this._log(`Could not open the MCP frontend channel: ${summarizeError(err)}`);
		}
	}

	/**
	 * Queue a registration hook behind the ones already running.
	 *
	 * @param hook The hook to run.
	 */
	private runHook(hook: () => void | Thenable<void>): void {
		this._hooks = this._hooks.then(hook).then(undefined, err => {
			this._log(`Failed to update the configured coding agents: ${summarizeError(err)}`);
		});
	}

	/** Close the channel, leaving the registration itself in place. */
	private closeChannel(): void {
		this._channel?.dispose();
		this._channel = undefined;
		this.setClients([]);
	}

	/**
	 * Adopt the supervisor's list of connected agents, logging who arrived and
	 * who left.
	 *
	 * @param clients The agents now connected, oldest first.
	 */
	private setClients(clients: McpClient[]): void {
		const before = new Set(this._clients.map(client => client.id));
		const after = new Set(clients.map(client => client.id));
		for (const client of clients.filter(client => !before.has(client.id))) {
			this._log(`${describeClient(client)} connected to this workspace's MCP server`);
		}
		for (const client of this._clients.filter(client => !after.has(client.id))) {
			this._log(`${describeClient(client)} disconnected from this workspace's MCP server`);
		}
		if (before.size === after.size && [...after].every(id => before.has(id))) {
			return;
		}
		this._clients = clients;
		this._onDidChangeClients.fire();
	}

	/**
	 * Publish the endpoint and token to the environments agents are started
	 * from: integrated terminals, and the extension host process, whose
	 * environment is inherited by the processes extensions spawn. The stdio
	 * bridge agents start reads these first; an agent that inherits neither
	 * falls back to the files written alongside, see
	 * {@link writeConnectionFiles}.
	 *
	 * Agents read these at startup, so a terminal or an extension host that
	 * predates registration has to be restarted to pick them up; the
	 * description explains that in the terminal's environment hover.
	 */
	private async publishEnvironment(connection: McpConnection): Promise<void> {
		this._environment.description = vscode.l10n.t(
			"Lets coding agents run code in this workspace's Positron sessions. Reopen a terminal to pick up changes.");
		this._environment.replace(MCP_URL_ENV_VAR, connection.url);
		this._environment.replace(MCP_TOKEN_ENV_VAR, connection.token);
		this._processEnv[MCP_URL_ENV_VAR] = connection.url;
		this._processEnv[MCP_TOKEN_ENV_VAR] = connection.token;
		try {
			await writeConnectionFiles(this._storageUri, connection);
		} catch (err) {
			// The environments above still carry the token, so agents started
			// from a terminal keep working; only those that find the workspace
			// by its folders are affected.
			this._log(`Could not write the MCP connection files: ${summarizeError(err)}`);
		}
	}

	/**
	 * Withdraw the endpoint and token from everywhere they were published.
	 *
	 * @param connection The registration being given up, if there was one.
	 */
	private async clearEnvironment(connection: McpConnection | undefined): Promise<void> {
		this._environment.clear();
		delete this._processEnv[MCP_URL_ENV_VAR];
		delete this._processEnv[MCP_TOKEN_ENV_VAR];
		if (connection) {
			try {
				await removeConnectionFiles(this._storageUri, connection);
			} catch (err) {
				// Leaving stale files behind is better than leaving the
				// endpoint registered, which is what aborting here would do:
				// the token would keep authenticating after the user turned
				// the feature off.
				this._log(`Could not remove the MCP connection files: ${summarizeError(err)}`);
			}
		}
	}
}

/**
 * The workspace's folders that an agent on this machine can be working in.
 *
 * @returns Their paths.
 */
function workspaceFolderPaths(): string[] {
	return (vscode.workspace.workspaceFolders ?? [])
		.filter(folder => folder.uri.scheme === 'file')
		.map(folder => folder.uri.fsPath);
}

/**
 * Whether Positron's MCP server should be running: the main AI switch and the
 * feature's own switch must both be on.
 *
 * @returns True when the feature is enabled.
 */
export function mcpFeatureEnabled(): boolean {
	const config = vscode.workspace.getConfiguration();
	return config.get<boolean>(AI_ENABLED_KEY) === true &&
		config.get<boolean>(MCP_ENABLED_KEY) === true;
}
