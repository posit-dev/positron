/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';

import { PositronSupervisorApi } from './positron-supervisor';
import { KCApi } from './KallichoreAdapterApi';
import { KallichoreTransport } from './KallichoreApiInstance';
import { KallichoreInstances } from './KallichoreInstances';

/** Singleton instance of the Kallichore API wrapper */
export let API_INSTANCE: KCApi;

/**
 * The reason the Positron window is shutting down, captured from
 * `positron.window.onWillShutdown` so it can be consulted from `deactivate()`.
 * Stays `undefined` if the event never fires (e.g. an unexpected ext host
 * crash) or if the RPC race causes us to miss it.
 */
let lastShutdownReason: positron.ShutdownReason | undefined;

export function activate(context: vscode.ExtensionContext): PositronSupervisorApi {
	const log = positron.window.createRawLogOutputChannel('Kernel Supervisor');
	log.appendLine('Positron Kernel Supervisor activated');
	KallichoreInstances.initialize(context, log);

	// Determine transport type from configuration
	const config = vscode.workspace.getConfiguration('kernelSupervisor');
	const configTransport = config.get<string>('transport', 'ipc');

	let transport: KallichoreTransport;
	if (configTransport === 'tcp') {
		transport = KallichoreTransport.TCP;
	} else if (configTransport === 'ipc') {
		// Use platform-appropriate IPC transport
		if (os.platform() === 'win32') {
			transport = KallichoreTransport.NamedPipe;
		} else {
			transport = KallichoreTransport.UnixSocket;
		}
	} else {
		// Default to TCP for unknown values
		transport = KallichoreTransport.TCP;
	}

	// Create the singleton instance of the Kallichore API wrapper
	API_INSTANCE = new KCApi(context, log, transport, true);

	// Register the supervisor commands
	API_INSTANCE.registerCommands();

	context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.showRunningSupervisors', () => {
		return KallichoreInstances.showRunningSupervisors();
	}));

	// Listen for the command to open the logs
	context.subscriptions.push(vscode.commands.registerCommand('positron.supervisor.showKernelSupervisorLog', () => {
		log.show();
	}));

	context.subscriptions.push(positron.window.onWillShutdown(reason => {
		lastShutdownReason = reason;
	}));

	return API_INSTANCE;
}

/**
 * Decides whether `deactivate()` should dispose the supervisor's local
 * connections. Exported so the decision logic can be exercised in tests
 * without driving the full extension lifecycle.
 *
 * Only desktop Quit disposes:
 * - Reload/Load: leave sessions in place so they reconnect when the window
 *   comes back up.
 * - Web (any reason): the supervisor server is hosted out-of-process and may
 *   be shared with other clients; let it keep running and rely on its idle
 *   timeout for cleanup.
 * - Unknown reason (e.g. RPC race during teardown): also leave it alone --
 *   we'd rather a stale server than tear down a live one we shouldn't.
 */
export function shouldDisposeOnDeactivate(
	reason: positron.ShutdownReason | undefined,
	uiKind: vscode.UIKind,
): boolean {
	return reason === positron.ShutdownReason.Quit && uiKind === vscode.UIKind.Desktop;
}

export async function deactivate(): Promise<void> {
	if (!API_INSTANCE) {
		return;
	}

	if (shouldDisposeOnDeactivate(lastShutdownReason, vscode.env.uiKind)) {
		// Ask the server to shut down before tearing down our local
		// connections. This is a no-op for detached servers that are meant to
		// outlive the application.
		await API_INSTANCE.shutdownForQuit();
		API_INSTANCE.dispose();
	}
}
