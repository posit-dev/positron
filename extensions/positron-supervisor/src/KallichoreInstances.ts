/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { KallichoreApiInstance, KallichoreTransport } from './KallichoreApiInstance.js';
import { KallichoreServerState } from './ServerState.js';
import { DefaultApi, ServerConfiguration, ServerStatus, SessionList } from './kcclient/api';
import { summarizeAxiosError } from './util';

/**
 * Snapshot of a running Kallichore supervisor persisted in global storage.
 */
interface StoredKallichoreInstance {
	workspaceName?: string;
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
		filtered.push({ workspaceName, state, lastSeen: Date.now() });
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

		const items = results.map(result => this.createQuickPickItem(result));
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
		const title = vscode.l10n.t("Sessions on {0}", supervisorLabel);

		if (sessions) {
			const content = sessions.sessions.length > 0 ? sessions.sessions.map(session => {
				const status = session.status;
				const duration = session.idle_seconds > 0 ? this.formatDuration(session.idle_seconds) : undefined;
				const connectionState = session.connected ? vscode.l10n.t("Connected") : vscode.l10n.t("Disconnected");
				const parts: string[] = [
					`${session.display_name} (${session.language})`,
					vscode.l10n.t("Status: {0}", status),
					connectionState
				];
				if (duration) {
					parts.push(vscode.l10n.t("Idle {0}", duration));
				}
				return parts.join(" • ");
			}).join("\n") : vscode.l10n.t("No sessions are currently running.");

			await positron.window.showSimpleModalDialogMessage(title, content, vscode.l10n.t("Close"));
			return;
		}

		const message = vscode.l10n.t("Unable to retrieve sessions: {0}", error ?? vscode.l10n.t("Unknown error"));
		await positron.window.showSimpleModalDialogMessage(title, message, vscode.l10n.t("Close"));
	}

	/**
	 * Shapes the information gathered from a supervisor into a Quick Pick entry.
	 *
	 * @param result The inspection result containing status/configuration data.
	 * @returns The Quick Pick item bound to the supervisor.
	 */
	private static createQuickPickItem(result: SupervisorInspectionResult): SupervisorQuickPickItem {
		const workspaceLabel = result.record.workspaceName ?? vscode.l10n.t("Unnamed Workspace");
		const transportLabel = this.formatTransport(result.record.state.transport);
		const description = vscode.l10n.t("PID {0} • {1}", result.record.state.server_pid, transportLabel);

		const detailParts: string[] = [];
		if (result.status) {
			detailParts.push(vscode.l10n.t("Sessions: {0}", result.status.sessions));
			detailParts.push(vscode.l10n.t("Active: {0}", result.status.active));
			const idleDetail = this.describeActivity(result.status);
			if (idleDetail) {
				detailParts.push(idleDetail);
			}
		}
		if (result.configuration) {
			detailParts.push(this.describeIdleShutdown(result.configuration.idle_shutdown_hours));
		}
		if (result.error) {
			detailParts.push(vscode.l10n.t("Status unavailable: {0}", result.error));
		}
		const detail = detailParts.length ? detailParts.join(" • ") : undefined;

		return {
			label: workspaceLabel,
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
	 * @returns User-friendly description of the shutdown behaviour.
	 */
	private static describeIdleShutdown(hours?: number): string {
		if (hours === undefined) {
			return vscode.l10n.t("Idle shutdown: default");
		}
		if (hours < 0) {
			return vscode.l10n.t("Idle shutdown: never");
		}
		if (hours === 0) {
			return vscode.l10n.t("Idle shutdown: immediate");
		}
		if (hours === 1) {
			return vscode.l10n.t("Idle shutdown: 1 hour");
		}
		return vscode.l10n.t("Idle shutdown: {0} hours", hours);
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
	 * Formats a timestamp suitable for prefixing log messages.
	 *
	 * @returns A HH:MM:SS UTC timestamp string.
	 */
	private static timestamp(): string {
		return new Date().toISOString().substring(11, 19);
	}
}
