/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPositronMcpService } from '../../../../platform/positronMcp/common/positronMcp.js';
import { McpAuditEvent } from '../../../../platform/positronMcp/common/positronMcpAudit.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { MCP_ENABLE_KEY } from '../common/positronMcpConfiguration.js';
import { IPositronMcpToolService } from './positronMcpToolService.js';
import { PositronMcpWorkspace, WorkspaceConfigState } from './positronMcpWorkspace.js';

const STATUS_ID = 'status.positronMcp';
const SHOW_STATUS_COMMAND = 'positron.mcp.showStatus';

/**
 * Safety net for a start event whose matching completion never arrived (the
 * session guarantees pairing, so this should never trip in practice).
 */
const STALE_CALL_MS = 10 * 60 * 1000;

/** A tool call currently in flight, tracked from its start audit event. */
interface IMcpInFlightCall {
	readonly toolName: string;
	readonly clientName?: string;
	readonly startedAt: number;
}

/** The inputs the status bar entry is computed from. */
export interface IMcpStatusBarState {
	readonly enabled: boolean;
	readonly configState: WorkspaceConfigState;
	readonly inFlightCount: number;
	/** The most recently started in-flight call, when any are running. */
	readonly latestInFlight?: { readonly toolName: string; readonly clientName?: string };
	readonly allowAll: boolean;
}

/**
 * The status bar entry for a given state, or undefined when the entry is
 * hidden. Text precedence: active (spinner) > allow-all attention > missing
 * config warning > idle; the kind stays 'warning' whenever allow-all or a
 * missing config needs attention, so an active spinner still carries the
 * warning color.
 */
export function computeMcpStatusEntry(state: IMcpStatusBarState): Pick<IStatusbarEntry, 'text' | 'tooltip' | 'kind'> | undefined {
	if (!state.enabled) {
		return undefined;
	}

	const needsAttention = state.configState === 'not-configured' || state.configState === 'stale';
	const kind = state.allowAll || needsAttention ? 'warning' : 'standard';

	if (state.inFlightCount > 0) {
		const client = state.latestInFlight?.clientName
			?? localize('positron.mcp.statusbar.unknownClient', "MCP client");
		const tooltip = state.inFlightCount === 1 && state.latestInFlight
			? localize('positron.mcp.statusbar.tooltip.active.one', "{0}: {1} running...", client, state.latestInFlight.toolName)
			: localize('positron.mcp.statusbar.tooltip.active.many', "{0} MCP tool calls running (latest: {1}). Click for details.", state.inFlightCount, state.latestInFlight?.toolName ?? client);
		return { text: '$(loading~spin) MCP', tooltip, kind };
	}

	if (state.allowAll) {
		return {
			text: '$(warning) MCP',
			tooltip: localize('positron.mcp.statusbar.tooltip.allowAll', "All agent code execution is allowed for this session. Click to review or reset."),
			kind,
		};
	}

	if (needsAttention) {
		return {
			text: '$(warning) MCP',
			tooltip: state.configState === 'stale'
				? localize('positron.mcp.statusbar.tooltip.stale', "MCP server enabled, but this workspace's .mcp.json is missing the current access token. Click for details.")
				: localize('positron.mcp.statusbar.tooltip.attention', "MCP server enabled, but this workspace has no .mcp.json. Click for details."),
			kind,
		};
	}

	return {
		text: '$(plug) MCP',
		tooltip: localize('positron.mcp.statusbar.tooltip.ok', "MCP server enabled. Click for details."),
		kind,
	};
}

/**
 * Status bar entry for the Positron MCP server. Hidden while the server is
 * disabled (the default); when enabled it shows a plug, switching to a spinner
 * while an agent's tool call is in flight and to a warning when something
 * needs attention -- allow-all consent is active, or the workspace has no
 * `.mcp.json` (the server runs but this project can't reach it). Clicking it
 * opens the status panel.
 *
 * It refreshes on the things that change what it reports: the enable setting,
 * the first folder's `.mcp.json`, which folders are open, the server's live
 * audit events, and the allow-all consent decision. Activity from every window
 * shows here: the server is shared, so a call pinned to another window still
 * signals agent presence in this one.
 */
export class PositronMcpStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronMcpStatusBar';

	private readonly _entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly _configWatcher = this._register(new MutableDisposable());
	private readonly _workspace: PositronMcpWorkspace;

	/** Tool calls currently in flight, keyed by the audit callId. */
	private readonly _inFlight = new Map<string, IMcpInFlightCall>();
	private _allowAll: boolean;

	constructor(
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IPositronMcpService mcpService: IPositronMcpService,
		@IPositronMcpToolService toolService: IPositronMcpToolService,
	) {
		super();
		this._workspace = new PositronMcpWorkspace(this._fileService, this._workspaceContextService, mcpService);
		this._allowAll = toolService.isAllowAllConsentActive();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(MCP_ENABLE_KEY)) {
				this._update();
			}
		}));
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._watchConfigFile();
			this._update();
		}));
		this._register(mcpService.onDidRecordActivity(event => this._onActivity(event)));
		this._register(toolService.onDidChangeAllowAllConsent(value => {
			this._allowAll = value;
			this._update();
		}));

		this._watchConfigFile();
		this._update();
	}

	/** Track in-flight calls from the audit event stream. */
	private _onActivity(event: McpAuditEvent): void {
		if (event.type === 'tool-call-start') {
			this._inFlight.set(event.callId, {
				toolName: event.toolName,
				clientName: event.clientName,
				startedAt: event.timestamp,
			});
		} else if (event.type === 'tool-call') {
			this._inFlight.delete(event.callId);
			this._sweepStaleCalls();
		} else {
			// Lifecycle events don't affect the indicator.
			return;
		}
		this._update();
	}

	private _sweepStaleCalls(): void {
		const cutoff = Date.now() - STALE_CALL_MS;
		for (const [callId, call] of this._inFlight) {
			if (call.startedAt < cutoff) {
				this._inFlight.delete(callId);
			}
		}
	}

	/** Watch the first folder's `.mcp.json` so the entry tracks config changes. */
	private _watchConfigFile(): void {
		const folder = this._workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!folder) {
			this._configWatcher.clear();
			return;
		}
		const configUri = URI.joinPath(folder, '.mcp.json');
		const watcher = this._fileService.createWatcher(folder, { recursive: false, excludes: [] });
		this._configWatcher.value = watcher;
		watcher.onDidChange(e => {
			if (e.contains(configUri)) {
				this._update();
			}
		});
	}

	private async _update(): Promise<void> {
		const enabled = this._configurationService.getValue<boolean>(MCP_ENABLE_KEY) === true;
		if (!enabled) {
			this._inFlight.clear();
			this._entry.clear();
			return;
		}

		const configState = await this._workspace.getConfigState();
		let latestInFlight: (IMcpInFlightCall & { callId: string }) | undefined;
		for (const [callId, call] of this._inFlight) {
			if (!latestInFlight || call.startedAt >= latestInFlight.startedAt) {
				latestInFlight = { callId, ...call };
			}
		}

		const computed = computeMcpStatusEntry({
			enabled,
			configState,
			inFlightCount: this._inFlight.size,
			latestInFlight,
			allowAll: this._allowAll,
		});
		if (!computed) {
			this._entry.clear();
			return;
		}

		const entry: IStatusbarEntry = {
			name: localize('positron.mcp.statusbar.name', "Positron MCP"),
			ariaLabel: localize('positron.mcp.statusbar.ariaLabel', "Positron MCP server"),
			command: SHOW_STATUS_COMMAND,
			...computed,
		};

		if (this._entry.value) {
			this._entry.value.update(entry);
		} else {
			this._entry.value = this._statusbarService.addEntry(entry, STATUS_ID, StatusbarAlignment.RIGHT, 100);
		}
	}
}
