/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { KallichoreApiInstance, KallichoreTransport } from './KallichoreApiInstance.js';
import { KallichoreServerState } from './ServerState.js';
import { ActiveSession, DefaultApi, ServerConfiguration, ServerStatus, SessionList, SessionMode, Status } from './kcclient/api';
import { summarizeAxiosError } from './util';

/**
 * Snapshot of a running Kallichore supervisor persisted in global storage.
 */
interface StoredKallichoreInstance {
	workspaceName?: string;
	workspaceUri?: string;
	state: KallichoreServerState;
	lastSeen: number;
}

/**
 * Results gathered while probing a supervisor for status and configuration.
 */
interface SupervisorInspectionResult {
	record: StoredKallichoreInstance;
	status?: ServerStatus;
	configuration?: ServerConfiguration;
	error?: string;
	api?: DefaultApi;
}

/**
 * Quick Pick entry augmented with inspection metadata.
 */
interface SupervisorQuickPickItem extends vscode.QuickPickItem {
	instance: SupervisorInspectionResult;
}

interface SupervisorSessionQuickPickItem extends vscode.QuickPickItem {
	action?: 'shutdown' | 'openWorkspace' | 'showLogs';
	session?: ActiveSession;
	workspaceUri?: vscode.Uri;
	sessionCount?: number;
}

/**
 * Tracks Kallichore supervisors that may outlive the current Positron session and surfaces
 * tooling for inspecting and pruning them.
 */
export class KallichoreInstances {
	private static readonly STORAGE_KEY = 'positron-supervisor.running-supervisors';
	private static context: vscode.ExtensionContext | undefined;
	private static log: vscode.OutputChannel | undefined;

	/**
	 * Initializes the global instance lifecycle tracker.
	 *
	 * @param context The extension context used for global storage.
	 * @param log Extension output channel used for diagnostic logging.
	 */
	public static initialize(context: vscode.ExtensionContext, log: vscode.OutputChannel) {
		this.context = context;
		this.log = log;
	}

	/**
	 * Records a newly started or reattached supervisor in global storage.
	 *
	 * @param workspaceName The workspace associated with the supervisor, if any.
	 * @param state The Kallichore server state to persist.
	 *
	 * @returns A promise that resolves after the registry has been updated.
	 */
	public static async recordSupervisor(workspaceName: string | undefined, state: KallichoreServerState): Promise<void> {
		const instances = await this.getStoredInstances();
		const filtered = instances.filter(instance => !this.matchesInstance(instance.state, state));
		const workspaceUri = this.resolveWorkspaceUri(workspaceName);
		filtered.push({ workspaceName, workspaceUri: workspaceUri?.toString(), state, lastSeen: Date.now() });
		await this.saveInstances(filtered);
		this.log?.appendLine(`${this.timestamp()} [Positron] Added supervisor PID ${state.server_pid} to registry`);
	}

	/**
	 * Removes a supervisor record when its backing process is confirmed stopped.
	 *
	 * @param pid The process identifier belonging to the supervisor instance.
	 *
	 * @returns A promise that resolves after the registry has been updated.
	 */
	public static async removeByPid(pid: number): Promise<void> {
		const instances = await this.getStoredInstances();
		const filtered = instances.filter(instance => instance.state.server_pid !== pid);
		if (filtered.length !== instances.length) {
			await this.saveInstances(filtered);
			this.log?.appendLine(`${this.timestamp()} [Positron] Removed supervisor PID ${pid} from registry`);
		}
	}

	/**
	 * Probes each persisted supervisor, pruning stale entries and presenting an inspection picker.
	 *
	 * @returns A promise that resolves after the inspection UI has been dismissed.
	 */
	public static async showRunningSupervisors(): Promise<void> {
		const stored = await this.getStoredInstances();
		const results = await vscode.window.withProgress<SupervisorInspectionResult[]>({
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t("Checking running kernel supervisors…"),
			cancellable: false
		}, async progress => {
			if (stored.length === 0) {
				return [];
			}

			const survivors: StoredKallichoreInstance[] = [];
			const liveResults: SupervisorInspectionResult[] = [];
			const increment = 100 / stored.length;

			for (const record of stored) {
				// Update the toast so users see which entry is under inspection.
				progress.report({ message: record.workspaceName ?? vscode.l10n.t("Unnamed Workspace") });

				if (!this.isProcessAlive(record.state.server_pid)) {
					// Mark work complete for the progress UI even though we prune this entry.
					progress.report({ increment, message: record.workspaceName ?? vscode.l10n.t("Unnamed Workspace") });
					this.log?.appendLine(`${this.timestamp()} [Positron] Pruned exited supervisor PID ${record.state.server_pid}`);
					continue;
				}

				// Track instances we confirmed are still alive so the registry
				// only retains valid entries.
				const refreshedRecord: StoredKallichoreInstance = {
					workspaceName: record.workspaceName,
					workspaceUri: record.workspaceUri ?? this.resolveWorkspaceUri(record.workspaceName)?.toString(),
					state: record.state,
					lastSeen: Date.now()
				};
				survivors.push(refreshedRecord);

				const inspection: SupervisorInspectionResult = { record: refreshedRecord };
				try {
					inspection.api = this.createApi(record.state);
					// Fetch status/configuration in parallel to keep the progress UI responsive.
					const [status, configuration] = await Promise.all([
						inspection.api.serverStatus({ timeout: 3000 }).then(response => response.data),
						inspection.api.getServerConfiguration({ timeout: 3000 }).then(response => response.data).catch(() => undefined)
					]);
					inspection.status = status;
					inspection.configuration = configuration;
				} catch (err) {
					inspection.error = summarizeAxiosError(err);
				}

				liveResults.push(inspection);
				// Record progress after both process validation and status probe complete.
				progress.report({ increment, message: record.workspaceName ?? vscode.l10n.t("Unnamed Workspace") });
			}

			await this.saveInstances(survivors);
			return liveResults;
		});

		if (results.length === 0) {
			await vscode.window.showInformationMessage(vscode.l10n.t("No running kernel supervisors were found."));
			return;
		}

		const sortedResults = [...results].sort((left, right) => this.getIdleSeconds(left) - this.getIdleSeconds(right));
		const items = sortedResults.map(result => this.createQuickPickItem(result));
		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: vscode.l10n.t("Select a kernel supervisor to inspect"),
			ignoreFocusOut: true
		});

		if (!selection) {
			return;
		}

		await this.showSessions(selection.instance);
	}

	/**
	 * Retrieves and displays the session list for a single supervisor in a modal dialog.
	 *
	 * @param result The inspected supervisor metadata.
	 * @returns A promise that resolves after the dialog has been shown.
	 */
	private static async showSessions(result: SupervisorInspectionResult): Promise<void> {
		if (!result.api) {
			result.api = this.createApi(result.record.state);
		}

		let sessions: SessionList | undefined;
		let error: string | undefined;

		try {
			sessions = (await result.api.listSessions({ timeout: 3000 })).data;
		} catch (err) {
			error = summarizeAxiosError(err);
		}

		const supervisorLabel = result.record.workspaceName ?? vscode.l10n.t("Unnamed Workspace");
		const workspaceUri = this.parseWorkspaceUri(result.record);
		const items: SupervisorSessionQuickPickItem[] = [];
		const sessionCount = sessions ? sessions.sessions.length : result.status?.sessions;

		items.push({
			label: vscode.l10n.t("Actions"),
			kind: vscode.QuickPickItemKind.Separator
		});

		if (workspaceUri && result.record.workspaceName) {
			items.push({
				label: `$(folder) ${vscode.l10n.t("Open Workspace '{0}'", result.record.workspaceName)}`,
				detail: vscode.l10n.t("Open the workspace in a new window"),
				action: 'openWorkspace',
				workspaceUri
			});
		}

		items.push({
			label: `$(note) ${vscode.l10n.t("Show Logs")}`,
			detail: vscode.l10n.t("Open the supervisor log file"),
			action: 'showLogs'
		});

		items.push({
			label: `$(trash) ${vscode.l10n.t("Shutdown")}`,
			detail: vscode.l10n.t("Stop this supervisor and terminate all sessions"),
			action: 'shutdown',
			sessionCount
		});

		items.push({
			label: vscode.l10n.t("Sessions"),
			kind: vscode.QuickPickItemKind.Separator
		});

		if (sessions && sessions.sessions.length > 0) {
			for (const session of sessions.sessions) {
				items.push(this.createSessionQuickPickItem(session));
			}
		} else if (sessions) {
			items.push({
				label: `$(circle-large-outline) ${vscode.l10n.t("No sessions are currently running.")}`,
				alwaysShow: true
			});
		} else if (error) {
			items.push({
				label: `$(warning) ${vscode.l10n.t("Unable to retrieve sessions")}`,
				detail: error,
				alwaysShow: true
			});
		}

		const selection = await vscode.window.showQuickPick<SupervisorSessionQuickPickItem>(items, {
			placeHolder: vscode.l10n.t("Select an action or session for {0}", supervisorLabel),
			ignoreFocusOut: true
		});

		if (!selection) {
			return;
		}

		if (selection.session) {
			await this.showSessionSummary(selection.session);
			return;
		}

		switch (selection.action) {
			case 'shutdown':
				await this.handleShutdownAction(result, supervisorLabel, selection.sessionCount);
				return;
			case 'showLogs':
				await this.handleShowLogsAction(result);
				return;
			case 'openWorkspace':
				if (selection.workspaceUri) {
					await this.handleOpenWorkspaceAction(selection.workspaceUri, supervisorLabel);
				} else {
					await vscode.window.showErrorMessage(vscode.l10n.t("Workspace location is unavailable."));
				}
				return;
			default:
				return;
		}
	}

	/**
	 * Shapes the information gathered from a supervisor into a Quick Pick entry.
	 *
	 * @param result The inspection result containing status/configuration data.
	 * @returns The Quick Pick item bound to the supervisor.
	 */
	private static createQuickPickItem(result: SupervisorInspectionResult): SupervisorQuickPickItem {
		const workspaceLabel = result.record.workspaceName ?? vscode.l10n.t("Unnamed Workspace");
		const uptimeLabel = this.formatUptime(result.status?.uptime_seconds);
		const description = uptimeLabel
			? vscode.l10n.t("PID {0} • Started {1}", result.record.state.server_pid, uptimeLabel)
			: vscode.l10n.t("PID {0} • {1}", result.record.state.server_pid, this.formatTransport(result.record.state.transport));

		const detailParts: string[] = [];
		const isCurrentWindowSupervisor = this.isCurrentWindowSupervisor(result.record);
		if (result.status) {
			if (result.status.sessions === 1) {
				detailParts.push(vscode.l10n.t("1 session"));
			} else {
				detailParts.push(vscode.l10n.t("{0} sessions", result.status.sessions));
			}
			const idleDetail = this.describeActivity(result.status);
			if (idleDetail) {
				detailParts.push(idleDetail);
			}
		}
		if (isCurrentWindowSupervisor) {
			detailParts.push(vscode.l10n.t("Connected to this window"));
		} else if (result.configuration) {
			detailParts.push(this.describeIdleShutdown(result.configuration.idle_shutdown_hours, result.status));
		}
		if (result.error) {
			detailParts.push(vscode.l10n.t("Status unavailable: {0}", result.error));
		}
		const detail = detailParts.length ? detailParts.join(" • ") : undefined;

		return {
			label: `$(folder) ${workspaceLabel}`,
			description,
			detail,
			instance: result
		};
	}

	/**
	 * Summarizes activity state for display alongside the Quick Pick entry.
	 *
	 * @param status The server activity snapshot.
	 * @returns Display text describing idle/busy durations, if available.
	 */
	private static describeActivity(status: ServerStatus): string | undefined {
		if (status.busy) {
			return status.busy_seconds > 0 ? vscode.l10n.t("Busy {0}", this.formatDuration(status.busy_seconds)) : vscode.l10n.t("Busy");
		}
		if (status.idle_seconds > 0) {
			return vscode.l10n.t("Idle {0}", this.formatDuration(status.idle_seconds));
		}
		return undefined;
	}

	/**
	 * Builds user-facing text describing the idle shutdown policy in effect.
	 *
	 * @param hours The idle shutdown threshold reported by the server.
	 * @param status The server status used to determine remaining idle time, if available.
	 * @returns User-friendly description of the shutdown behaviour.
	 */
	private static describeIdleShutdown(hours: number | undefined, status: ServerStatus | undefined): string {
		if (hours === undefined) {
			return vscode.l10n.t("Idle shutdown: default");
		}
		if (hours < 0) {
			return vscode.l10n.t("Idle shutdown: never");
		}
		if (hours === 0) {
			return vscode.l10n.t("Idle shutdown: immediate");
		}
		const baseLabel = hours === 1 ? vscode.l10n.t("Idle shutdown: 1 hour") : vscode.l10n.t("Idle shutdown: {0} hours", hours);
		if (!status || status.busy) {
			return baseLabel;
		}
		const idleSeconds = status.idle_seconds;
		if (idleSeconds === undefined) {
			return baseLabel;
		}
		const totalSeconds = hours * 3600;
		const remainingSeconds = Math.max(0, totalSeconds - idleSeconds);
		const remainingLabel = this.formatHoursMinutes(remainingSeconds);
		return vscode.l10n.t("{0} ({1} remaining)", baseLabel, remainingLabel);
	}

	/**
	 * Converts an uptime duration into a relative "time ago" label.
	 *
	 * @param uptimeSeconds The reported uptime in seconds.
	 * @returns A localized "time ago" label, if the uptime is valid.
	 */
	private static formatUptime(uptimeSeconds: number | undefined): string | undefined {
		if (uptimeSeconds === undefined || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
			return undefined;
		}
		const seconds = Math.floor(uptimeSeconds);
		if (seconds < 60) {
			return seconds === 1 ? vscode.l10n.t("1 second ago") : vscode.l10n.t("{0} seconds ago", seconds);
		}
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) {
			return minutes === 1 ? vscode.l10n.t("1 minute ago") : vscode.l10n.t("{0} minutes ago", minutes);
		}
		const hours = Math.floor(minutes / 60);
		if (hours < 24) {
			return hours === 1 ? vscode.l10n.t("1 hour ago") : vscode.l10n.t("{0} hours ago", hours);
		}
		const days = Math.floor(hours / 24);
		if (days < 30) {
			return days === 1 ? vscode.l10n.t("1 day ago") : vscode.l10n.t("{0} days ago", days);
		}
		const months = Math.floor(days / 30);
		if (months < 12) {
			return months === 1 ? vscode.l10n.t("1 month ago") : vscode.l10n.t("{0} months ago", months);
		}
		const years = Math.floor(months / 12);
		return years === 1 ? vscode.l10n.t("1 year ago") : vscode.l10n.t("{0} years ago", years);
	}

	/**
	 * Formats the transport type associated with a supervisor.
	 *
	 * @param transport The transport value reported by the supervisor.
	 * @returns Localized transport label.
	 */
	private static formatTransport(transport?: KallichoreTransport): string {
		switch (transport) {
			case KallichoreTransport.UnixSocket:
				return vscode.l10n.t("Unix socket");
			case KallichoreTransport.NamedPipe:
				return vscode.l10n.t("Named pipe");
			case KallichoreTransport.TCP:
			default:
				return vscode.l10n.t("TCP");
		}
	}

	/**
	 * Formats a duration in seconds into a compact display string.
	 *
	 * @param totalSeconds The duration in seconds.
	 * @returns Short human-readable duration string.
	 */
	private static formatDuration(totalSeconds: number): string {
		const seconds = Math.max(0, Math.floor(totalSeconds));
		if (seconds === 0) {
			return vscode.l10n.t("0s");
		}

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		const parts: string[] = [];
		if (hours > 0) {
			parts.push(vscode.l10n.t("{0}h", hours));
		}
		if (minutes > 0) {
			parts.push(vscode.l10n.t("{0}m", minutes));
		}
		if (secs > 0 && parts.length === 0) {
			parts.push(vscode.l10n.t("{0}s", secs));
		}

		return parts.join(" ");
	}

	/**
	 * Converts a duration in seconds to a string formatted as H:MM.
	 *
	 * @param totalSeconds The total number of seconds remaining.
	 * @returns A compact hours/minutes string suitable for UI display.
	 */
	private static formatHoursMinutes(totalSeconds: number): string {
		const seconds = Math.max(0, Math.floor(totalSeconds));
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		return `${hours}:${minutes.toString().padStart(2, '0')}`;
	}

	/**
	 * Reads the current set of persisted supervisor entries.
	 *
	 * @returns A clone of the stored supervisor list.
	 */
	private static async getStoredInstances(): Promise<StoredKallichoreInstance[]> {
		const context = this.getContext();
		const instances = context.globalState.get<StoredKallichoreInstance[]>(this.STORAGE_KEY) ?? [];
		return instances.map(instance => ({ ...instance }));
	}

	/**
	 * Persists the provided supervisor entries back to global storage.
	 *
	 * @param instances The supervisor entries to store.
	 * @returns A promise that resolves after storage has been updated.
	 */
	private static async saveInstances(instances: StoredKallichoreInstance[]): Promise<void> {
		const context = this.getContext();
		await context.globalState.update(this.STORAGE_KEY, instances);
	}

	/**
	 * Creates a Kallichore API client bound to the provided server state.
	 *
	 * @param state The supervisor connection information.
	 * @returns A configured API client targeting the supervisor.
	 */
	private static createApi(state: KallichoreServerState): DefaultApi {
		const transport = state.transport ?? KallichoreTransport.TCP;
		const apiInstance = new KallichoreApiInstance(transport);
		apiInstance.loadState(state);
		return apiInstance.api;
	}

	/**
	 * Retrieves the idle duration reported for a supervisor. Missing data sorts to the end.
	 *
	 * @param result The inspection result containing status information.
	 * @returns Idle time in seconds, or a large sentinel when unavailable.
	 */
	private static getIdleSeconds(result: SupervisorInspectionResult): number {
		if (!result.status) {
			return Number.POSITIVE_INFINITY;
		}
		return result.status.idle_seconds;
	}

	/**
	 * Determines whether a supervisor process is still running, allowing for EPERM on restricted hosts.
	 *
	 * @param pid The process identifier to probe.
	 * @returns True if the process appears to be alive, false otherwise.
	 */
	private static isProcessAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			return error?.code === 'EPERM';
		}
	}

	/**
	 * Detects whether two supervisors refer to the same underlying instance.
	 *
	 * @param left The existing supervisor state.
	 * @param right The supervisor state to compare.
	 * @returns True if both states reference the same instance.
	 */
	private static matchesInstance(left: KallichoreServerState, right: KallichoreServerState): boolean {
		return left.server_pid === right.server_pid ||
			(Boolean(left.base_path) && Boolean(right.base_path) && left.base_path === right.base_path) ||
			(Boolean(left.socket_path) && Boolean(right.socket_path) && left.socket_path === right.socket_path) ||
			(Boolean(left.named_pipe) && Boolean(right.named_pipe) && left.named_pipe === right.named_pipe);
	}

	/**
	 * Retrieves the initialized extension context or throws if initialization has not occurred.
	 *
	 * @returns The extension context previously provided to {@link initialize}.
	 */
	private static getContext(): vscode.ExtensionContext {
		if (!this.context) {
			throw new Error('KallichoreInstances has not been initialized');
		}
		return this.context;
	}

	/**
	 * Creates a Quick Pick entry that summarizes an active session for the inspector UI.
	 *
	 * @param session The active session returned from the supervisor.
	 * @returns A Quick Pick item with session metadata bound to it.
	 */
	private static createSessionQuickPickItem(session: ActiveSession): SupervisorSessionQuickPickItem {
		const icon = this.getSessionIcon(session.session_mode);
		const label = `${icon} ${session.display_name} (${session.language})`;
		const connectionState = session.connected ? vscode.l10n.t("Connected") : vscode.l10n.t("Disconnected");
		const parts: string[] = [
			vscode.l10n.t("Status: {0}", session.status),
			connectionState
		];
		const activity = this.describeSessionActivity(session);
		if (activity) {
			parts.push(activity);
		}

		return {
			label,
			detail: parts.join(' • '),
			session
		};
	}

	/**
	 * Summarizes session activity so it can be displayed in the inspector UI.
	 *
	 * @param session The active session whose activity should be described.
	 * @returns A localized description of recent activity, or undefined when not applicable.
	 */
	private static describeSessionActivity(session: ActiveSession): string | undefined {
		if (session.status === 'busy' && session.busy_seconds > 0) {
			return vscode.l10n.t("Busy {0}", this.formatDuration(session.busy_seconds));
		}
		if (session.status !== 'busy' && session.idle_seconds > 0) {
			return vscode.l10n.t("Idle {0}", this.formatDuration(session.idle_seconds));
		}
		return undefined;
	}

	/**
	 * Selects an icon string that represents the session mode in the Quick Pick UI.
	 *
	 * @param mode The session mode reported by the supervisor.
	 * @returns The codicon identifier to prefix the session label with.
	 */
	private static getSessionIcon(mode: SessionMode): string {
		if (mode === 'notebook') {
			return '$(notebook)';
		}
		return '$(terminal)';
	}

	/**
	 * Resolves a stored supervisor record to a workspace URI if one is known.
	 *
	 * @param record The supervisor record that may contain a serialized workspace URI.
	 * @returns The parsed workspace URI, or undefined when unavailable.
	 */
	private static parseWorkspaceUri(record: StoredKallichoreInstance): vscode.Uri | undefined {
		if (record.workspaceUri) {
			try {
				return vscode.Uri.parse(record.workspaceUri);
			} catch {
				return undefined;
			}
		}
		return this.resolveWorkspaceUri(record.workspaceName);
	}

	/**
	 * Determines whether the supervisor is associated with the currently open workspace.
	 *
	 * @param record The stored supervisor record to evaluate.
	 * @returns  True if the supervisor is tied to the current window, false otherwise.
	 */
	private static isCurrentWindowSupervisor(record: StoredKallichoreInstance): boolean {
		const supervisorUri = this.parseWorkspaceUri(record);
		if (!supervisorUri) {
			return false;
		}
		return vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === supervisorUri.toString()) ?? false;
	}

	/**
	 * Locates a workspace folder by name within the current VS Code session.
	 *
	 * @param workspaceName The display name of the workspace folder.
	 * @returns The URI of the workspace folder if it is open, otherwise undefined.
	 */
	private static resolveWorkspaceUri(workspaceName: string | undefined): vscode.Uri | undefined {
		if (!workspaceName) {
			return undefined;
		}
		const folder = vscode.workspace.workspaceFolders?.find(candidate => candidate.name === workspaceName);
		return folder?.uri;
	}

	/**
	 * Handles the shutdown action by prompting the user and invoking the server shutdown API.
	 *
	 * @param result The supervisor inspection result containing the API client and state.
	 * @param supervisorLabel The user-facing label of the supervisor being shut down.
	 * @param sessionCountHint Optional session count supplied when the status call was unavailable.
	 * @returns A promise that resolves once the shutdown flow completes.
	 */
	private static async handleShutdownAction(result: SupervisorInspectionResult, supervisorLabel: string, sessionCountHint?: number): Promise<void> {
		const sessionCount = sessionCountHint ?? result.status?.sessions;
		const messageParts: string[] = [
			vscode.l10n.t("Are you sure you want to shut down the supervisor for {0}?", supervisorLabel)
		];
		if (sessionCount !== undefined && sessionCount > 0) {
			const sessionLabel = sessionCount === 1
				? vscode.l10n.t("1 session will be ended.")
				: vscode.l10n.t("{0} sessions will be ended.", sessionCount);
			messageParts.push(sessionLabel);
		} else {
			messageParts.push(vscode.l10n.t("This will terminate any running sessions."));
		}
		const confirmed = await positron.window.showSimpleModalDialogPrompt(
			vscode.l10n.t("Shut Down Supervisor"),
			messageParts.join(' '),
			vscode.l10n.t("Shut Down"),
			vscode.l10n.t("Cancel")
		);
		if (!confirmed) {
			return;
		}

		try {
			await result.api!.shutdownServer({ timeout: 3000 });
			await this.removeByPid(result.record.state.server_pid);
			this.log?.appendLine(`${this.timestamp()} [Positron] Requested shutdown for supervisor PID ${result.record.state.server_pid}`);
			await vscode.window.showInformationMessage(vscode.l10n.t("Supervisor shutdown requested."));
		} catch (err) {
			const message = summarizeAxiosError(err);
			await vscode.window.showErrorMessage(vscode.l10n.t("Failed to shut down supervisor: {0}", message));
		}
	}

	/**
	 * Opens the supervisor log file in an editor when available, reporting failures to the user.
	 *
	 * @param result The supervisor inspection result that includes the log path.
	 * @returns A promise that resolves after the log open workflow finishes.
	 */
	private static async handleShowLogsAction(result: SupervisorInspectionResult): Promise<void> {
		const logPath = result.record.state.log_path;
		if (!logPath) {
			await vscode.window.showErrorMessage(vscode.l10n.t("No log file path is available for this supervisor."));
			return;
		}

		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logPath));
			await vscode.window.showTextDocument(document, { preview: false });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await vscode.window.showErrorMessage(vscode.l10n.t("Failed to open supervisor log file: {0}", message));
		}
	}

	/**
	 * Opens the workspace tied to a supervisor in a new VS Code window when possible.
	 *
	 * @param workspaceUri The URI of the workspace folder that should be opened.
	 * @param supervisorLabel The label shown in the UI for the supervisor being opened.
	 * @returns A promise that resolves after the open workspace command completes.
	 */
	private static async handleOpenWorkspaceAction(workspaceUri: vscode.Uri, supervisorLabel: string): Promise<void> {
		try {
			await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, true);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await vscode.window.showErrorMessage(vscode.l10n.t("Failed to open workspace {0}: {1}", supervisorLabel, message));
		}
	}

	/**
	 * Presents a modal dialog summarizing a single session returned from the supervisor.
	 *
	 * @param session The session whose details should be surfaced to the user.
	 * @returns A promise that resolves after the dialog has been dismissed.
	 */
	private static async showSessionSummary(session: ActiveSession): Promise<void> {
		const message = this.composeSessionSummary(session);
		await positron.window.showSimpleModalDialogMessage(
			vscode.l10n.t("Session Details"),
			message,
			vscode.l10n.t("Close")
		);
	}

	/**
	 * Composes a short narrative describing the key attributes of a session.
	 *
	 * @param session The session whose metadata should be converted into prose.
	 * @returns A localized summary sentence suitable for dialog display.
	 */
	private static composeSessionSummary(session: ActiveSession): string {
		const sentences: string[] = [];
		sentences.push(vscode.l10n.t(
			"Session '{0}' (ID {1}, PID {2}) runs {3} in {4}.",
			session.display_name,
			session.session_id,
			session.process_id ? session.process_id.toString() : vscode.l10n.t("N/A"),
			session.language,
			this.describeSessionMode(session.session_mode)
		));

		const startedSentence = this.describeSessionStartSentence(session.started);
		if (startedSentence) {
			sentences.push(startedSentence);
		}

		const connectionSentence = this.describeSessionConnectionSentence(session);
		if (connectionSentence) {
			sentences.push(connectionSentence);
		}
		return sentences.join(' ');
	}

	/**
	 * Produces a human-readable label describing a session mode.
	 *
	 * @param mode The session mode enumeration value.
	 * @returns A localized description of the session mode.
	 */
	private static describeSessionMode(mode: SessionMode): string {
		switch (mode) {
			case SessionMode.Notebook:
				return vscode.l10n.t("notebook mode");
			case SessionMode.Background:
				return vscode.l10n.t("background mode");
			case SessionMode.Console:
			default:
				return vscode.l10n.t("console mode");
		}
	}

	/**
	 * Converts the session start timestamp into a descriptive sentence when possible.
	 *
	 * @param started The ISO timestamp returned by the supervisor.
	 * @returns A localized sentence indicating when the session started, or undefined.
	 */
	private static describeSessionStartSentence(started: string | undefined): string | undefined {
		if (!started) {
			return undefined;
		}
		const startedMs = Date.parse(started);
		if (Number.isNaN(startedMs)) {
			return undefined;
		}
		const diffSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
		const relative = this.formatUptime(diffSeconds);
		if (!relative) {
			return undefined;
		}
		return vscode.l10n.t("It started {0}.", relative);
	}

	/**
	 * Assembles a sentence describing a session's runtime status and activity.
	 *
	 * @param session The session whose status should be summarized.
	 * @returns A localized status sentence, or undefined when no details are available.
	 */
	private static describeSessionStatusSentence(session: ActiveSession): string | undefined {
		const statusLabel = this.describeStatusLabel(session.status);
		const activityDetail = this.describeSessionActivityDetail(session);
		if (activityDetail) {
			return vscode.l10n.t("It is currently {0} and {1}.", statusLabel, activityDetail);
		}
		return vscode.l10n.t("It is currently {0}.", statusLabel);
	}

	/**
	 * Maps a raw session status string into a localized, user-friendly label.
	 *
	 * @param status The status value reported by the supervisor.
	 * @returns The localized label corresponding to the status.
	 */
	private static describeStatusLabel(status: string): string {
		switch (status) {
			case Status.Busy:
				return vscode.l10n.t("busy");
			case Status.Idle:
				return vscode.l10n.t("idle");
			case Status.Starting:
				return vscode.l10n.t("starting");
			case Status.Ready:
				return vscode.l10n.t("ready");
			case Status.Offline:
				return vscode.l10n.t("offline");
			case Status.Exited:
				return vscode.l10n.t("exited");
			case Status.Uninitialized:
				return vscode.l10n.t("uninitialized");
			default:
				return status;
		}
	}

	/**
	 * Generates additional context about a session's busy or idle duration.
	 *
	 * @param session The session whose activity durations should be described.
	 * @returns A localized clause describing busy or idle time, or undefined if unavailable.
	 */
	private static describeSessionActivityDetail(session: ActiveSession): string | undefined {
		if (session.status === Status.Busy && session.busy_seconds > 0) {
			return vscode.l10n.t("has been busy for {0}", this.formatDuration(session.busy_seconds));
		}
		if (session.status !== Status.Busy && session.idle_seconds > 0) {
			return vscode.l10n.t("has been idle for {0}", this.formatDuration(session.idle_seconds));
		}
		return undefined;
	}

	/**
	 * Describes the connection state of a session along with any pending executions.
	 *
	 * @param session The session whose connection status should be narrated.
	 * @returns A localized sentence about the session's connection state.
	 */
	private static describeSessionConnectionSentence(session: ActiveSession): string | undefined {
		const queueLength = session.execution_queue?.length ?? 0;
		if (queueLength > 0) {
			const queueLabel = queueLength === 1
				? vscode.l10n.t("1 pending execution")
				: vscode.l10n.t("{0} pending executions", queueLength);
			if (session.connected) {
				return vscode.l10n.t("The session is connected to a client with {0}.", queueLabel);
			}
			return vscode.l10n.t("The session is not connected to any client and has {0}.", queueLabel);
		}
		return session.connected
			? vscode.l10n.t("The session is connected to a client.")
			: vscode.l10n.t("The session is not connected to any client.");
	}

	/**
	 * Formats a timestamp suitable for prefixing log messages.
	 *
	 * @returns A HH:MM:SS UTC timestamp string.
	 */
	private static timestamp(): string {
		return new Date().toISOString().substring(11, 19);
	}
}
