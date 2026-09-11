/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { McpFrontend as McpFrontendResponse, McpFrontendRegistration, McpStatus } from './kcclient/api';
import { McpFrontendChannel } from './McpFrontendChannel';
import { summarizeError } from './util';

// The `ai.*` settings below are registered by Positron core, in
// `positronAIConfigurationKeys.ts`; the extension host cannot import from
// `src/vs`, so the keys are repeated here.

/** The main AI switch; when off, no AI feature may run. */
export const AI_ENABLED_KEY = 'ai.enabled';

/** Whether this window offers its sessions and commands to external agents. */
export const MCP_ENABLED_KEY = 'ai.mcp.enabled';

/** The port the MCP listener should prefer, or 0 to let the server choose. */
export const MCP_PORT_KEY = 'ai.mcp.port';

/** Environment variable naming the MCP endpoint in integrated terminals. */
export const MCP_URL_ENV_VAR = 'POSITRON_MCP_URL';

/** Environment variable carrying the MCP bearer token. */
export const MCP_TOKEN_ENV_VAR = 'POSITRON_MCP_TOKEN';

/** Command that puts the MCP endpoint and token on the clipboard. */
export const COPY_MCP_DETAILS_COMMAND = 'positron.mcp.copyConnectionDetails';

/**
 * What is remembered between registrations, so that a re-registered frontend
 * keeps the token that agents in already-open terminals are using, and an
 * agent's configured URL keeps pointing at the right port.
 */
export interface McpFrontendState {
	/**
	 * The frontend ID the supervisor issued. Only meaningful while we are
	 * talking to the same server process that issued it, since the registry
	 * (and therefore the token behind the ID) lives in that process.
	 */
	frontendId?: string;

	/** The port the listener was last bound to. */
	port?: number;
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
	registerMcpFrontend(registration: McpFrontendRegistration): Promise<{ data: McpFrontendResponse }>;
	deregisterMcpFrontend(frontendId: string): Promise<unknown>;
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

/** A live MCP registration: everything an agent needs in order to connect. */
export interface McpConnection {
	/** The frontend ID issued by the supervisor. */
	frontendId: string;

	/** The port the listener is bound to. */
	port: number;

	/** The bearer token agents present. Never logged or written to disk. */
	token: string;

	/** The MCP endpoint URL. */
	url: string;
}

/**
 * Registers this Positron window with the supervisor's MCP server so external
 * coding agents can reach its sessions, and publishes the resulting endpoint
 * and token into integrated terminals.
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

	/** The supervisor API, once a supervisor is available. */
	private _api: McpRegistrationApi | undefined;

	/** Serializes syncs so overlapping settings changes can't race. */
	private _syncing: Promise<void> = Promise.resolve();

	/** Resolves the channel target for a registered frontend. */
	private _channelTarget: ((frontendId: string) => McpChannelTarget) | undefined;

	/** The channel over which we broker commands, while registered. */
	private _channel: McpFrontendChannel | undefined;

	private readonly _disposables: vscode.Disposable[] = [];

	/**
	 * @param _environment The terminal environment collection to publish into.
	 * @param _log Writes a line to the Kernel Supervisor output channel.
	 * @param _loadState Reads the state left by a previous registration.
	 * @param _saveState Persists the state, or clears it when undefined.
	 * @param _sessionIds The sessions this window holds. With the sessions it
	 *  created, these are the only ones agents attached to it may reach.
	 * @param _enabled Whether the feature is turned on. Read on every sync
	 *  rather than cached, since both switches apply without a reload and
	 *  `ai.enabled` can be enforced by a Workbench administrator at any time.
	 * @param _onRegistered Called once the endpoint is live, for work that
	 *  should not point agents at a listener that does not exist yet.
	 */
	constructor(
		private readonly _environment: McpTerminalEnvironment,
		private readonly _log: (message: string) => void,
		private readonly _loadState: () => McpFrontendState,
		private readonly _saveState: (state: McpFrontendState) => Promise<void>,
		private readonly _sessionIds: () => string[],
		private readonly _enabled: () => boolean = mcpFeatureEnabled,
		private readonly _onRegistered: () => void = () => { },
	) {
		this._disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(AI_ENABLED_KEY) ||
				event.affectsConfiguration(MCP_ENABLED_KEY)) {
				this.sync();
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
	 * Point the frontend at a supervisor that has just started or been
	 * reconnected to, and bring registration in line with the settings.
	 *
	 * @param api The API of the supervisor now serving this window.
	 * @param channelTarget Resolves the frontend channel's WebSocket URI and
	 *  headers, once a frontend ID has been issued.
	 */
	public async attach(
		api: McpRegistrationApi,
		channelTarget?: (frontendId: string) => McpChannelTarget,
	): Promise<void> {
		this._api = api;
		this._channelTarget = channelTarget;
		// A new server process means a new (empty) frontend registry, so the
		// registration we may have been holding no longer exists there.
		this.closeChannel();
		this._connection = undefined;
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
			"Copied the MCP connection details for {0}. Treat the token like a password: it lets an agent run code in this window's sessions.",
			this._connection.url));
	}

	public dispose() {
		this.closeChannel();
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables.length = 0;
	}

	/**
	 * The port to ask the supervisor for, so an agent's configured URL stays
	 * valid across restarts. An explicit setting wins; otherwise we ask for the
	 * port we were last given.
	 */
	private preferredPort(): number | undefined {
		const configured = vscode.workspace.getConfiguration().get<number>(MCP_PORT_KEY);
		return configured || this._loadState().port;
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
		if (this._connection) {
			return;
		}
		await this.register();
	}

	/** Register with the supervisor and publish the result to terminals. */
	private async register(): Promise<void> {
		const response = await this._api!.registerMcpFrontend({
			frontend_id: this._loadState().frontendId,
			display_name: vscode.workspace.name ?? vscode.l10n.t("Empty Workspace"),
			preferred_port: this.preferredPort(),
			capabilities: { commands: true },
		});

		const { frontend_id: frontendId, token, port, url } = response.data;
		this._connection = { frontendId, token, port, url };
		await this._saveState({ frontendId, port });
		this.publishEnvironment(this._connection);
		this._log(`Registered MCP frontend ${frontendId}; agents can connect at ${url}`);
		this.openChannel(frontendId);
		this._onRegistered();
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
		this._connection = undefined;
		this.closeChannel();
		this._environment.clear();
		// Keep the port so re-enabling the feature reuses it, but forget the
		// frontend ID: deregistration invalidates it along with its token.
		await this._saveState({ port: connection?.port ?? this._loadState().port });
		if (!connection) {
			return;
		}
		await this._api!.deregisterMcpFrontend(connection.frontendId);
		this._log(`Deregistered MCP frontend ${connection.frontendId}`);
	}

	/**
	 * Open the channel that carries this window's command catalog to the
	 * supervisor and agents' command requests back.
	 *
	 * @param frontendId The ID the supervisor issued at registration.
	 */
	private openChannel(frontendId: string): void {
		if (!this._channelTarget) {
			return;
		}
		const target = this._channelTarget(frontendId);
		this._channel = new McpFrontendChannel(
			target.uri, target.headers, this._log, this._sessionIds);
	}

	/** Close the channel, leaving the registration itself in place. */
	private closeChannel(): void {
		this._channel?.dispose();
		this._channel = undefined;
	}

	/**
	 * Publish the endpoint and token into integrated terminals. Agents read
	 * these at startup, so terminals opened before registration need reopening;
	 * the description explains that in the terminal's environment hover.
	 */
	private publishEnvironment(connection: McpConnection): void {
		this._environment.description = vscode.l10n.t(
			"Lets coding agents run code in this window's Positron sessions. Reopen a terminal to pick up changes.");
		this._environment.replace(MCP_URL_ENV_VAR, connection.url);
		this._environment.replace(MCP_TOKEN_ENV_VAR, connection.token);
	}
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
