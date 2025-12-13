/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { LOGGER, supervisorApi } from './extension';
import { JuliaInstallation } from './julia-installation';
import { JupyterLanguageRuntimeSession, JupyterKernelSpec } from './positron-supervisor';

/**
 * Represents a Julia runtime session.
 */
export class JuliaSession implements positron.LanguageRuntimeSession, vscode.Disposable {

	/** The underlying Jupyter session */
	private _kernel?: JupyterLanguageRuntimeSession;

	/** Dynamic state of the session */
	public dynState: positron.LanguageRuntimeDynState;

	/** Runtime info (available after start) */
	public runtimeInfo: positron.LanguageRuntimeInfo = {
		banner: 'Julia',
		implementation_version: '',
		language_version: '',
	};

	/** Event emitters */
	private readonly _messageEmitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _stateEmitter = new vscode.EventEmitter<positron.RuntimeState>();
	private readonly _exitEmitter = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	/** Events */
	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;

	constructor(
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata,
		private readonly _installation: JuliaInstallation,
		readonly kernelSpec?: JupyterKernelSpec,
		sessionName?: string
	) {
		this.dynState = {
			inputPrompt: 'julia> ',
			continuationPrompt: '       ',
			sessionName: sessionName || runtimeMetadata.runtimeName,
		};

		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;
	}

	dispose(): void {
		this._messageEmitter.dispose();
		this._stateEmitter.dispose();
		this._exitEmitter.dispose();
	}

	/**
	 * Starts the Julia session.
	 */
	async start(): Promise<positron.LanguageRuntimeInfo> {
		LOGGER.info(`Starting Julia session ${this.metadata.sessionId}`);

		// Get the supervisor API
		const supervisor = await supervisorApi();

		// Create or restore the session via the supervisor
		if (this.kernelSpec) {
			// We have a kernel spec, so create a new session
			LOGGER.info(`Creating new Julia session with kernel spec`);
			this._kernel = await supervisor.createSession(
				this.runtimeMetadata,
				this.metadata,
				this.kernelSpec,
				this.dynState
			);
		} else {
			// We don't have a kernel spec, so restore (reconnect) an existing session
			LOGGER.info(`Restoring existing Julia session`);
			this._kernel = await supervisor.restoreSession(
				this.runtimeMetadata,
				this.metadata,
				this.dynState
			);
		}

		// Forward events from the Jupyter session
		this._kernel.onDidReceiveRuntimeMessage((msg: positron.LanguageRuntimeMessage) => {
			this._messageEmitter.fire(msg);
		});

		this._kernel.onDidChangeRuntimeState((state: positron.RuntimeState) => {
			this._stateEmitter.fire(state);
		});

		this._kernel.onDidEndSession((exit: positron.LanguageRuntimeExit) => {
			this._exitEmitter.fire(exit);
		});

		// Start the session
		const info = await this._kernel.start();
		this.runtimeInfo = info;
		return info;
	}

	execute(
		code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior
	): void {
		if (!this._kernel) {
			throw new Error('Session not started');
		}
		this._kernel.execute(code, id, mode, errorBehavior);
	}

	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		if (!this._kernel) {
			return Promise.resolve(positron.RuntimeCodeFragmentStatus.Unknown);
		}
		return this._kernel.isCodeFragmentComplete(code);
	}

	createClient(id: string, type: positron.RuntimeClientType, params: any, metadata?: any): Thenable<void> {
		if (!this._kernel) {
			throw new Error('Session not started');
		}
		return this._kernel.createClient(id, type, params, metadata);
	}

	listClients(type?: positron.RuntimeClientType): Thenable<Record<string, string>> {
		if (!this._kernel) {
			return Promise.resolve({});
		}
		return this._kernel.listClients(type);
	}

	removeClient(id: string): void {
		if (!this._kernel) {
			return;
		}
		this._kernel.removeClient(id);
	}

	sendClientMessage(clientId: string, messageId: string, message: any): void {
		if (!this._kernel) {
			throw new Error('Session not started');
		}
		this._kernel.sendClientMessage(clientId, messageId, message);
	}

	replyToPrompt(id: string, reply: string): void {
		if (!this._kernel) {
			throw new Error('Session not started');
		}
		this._kernel.replyToPrompt(id, reply);
	}

	async interrupt(): Promise<void> {
		if (!this._kernel) {
			return;
		}
		return this._kernel.interrupt();
	}

	async restart(workingDirectory?: string): Promise<void> {
		LOGGER.info(`Restarting Julia session ${this.metadata.sessionId}`);
		if (!this._kernel) {
			throw new Error('Cannot restart; kernel not started');
		}
		return this._kernel.restart(workingDirectory);
	}

	async shutdown(exitReason = positron.RuntimeExitReason.Shutdown): Promise<void> {
		LOGGER.info(`Shutting down Julia session ${this.metadata.sessionId}`);
		if (!this._kernel) {
			throw new Error('Cannot shutdown; kernel not started');
		}
		return this._kernel.shutdown(exitReason);
	}

	async forceQuit(): Promise<void> {
		LOGGER.info(`Force quitting Julia session ${this.metadata.sessionId}`);
		if (!this._kernel) {
			throw new Error('Cannot force quit; kernel not started');
		}
		return this._kernel.forceQuit();
	}

	showOutput(channel?: positron.LanguageRuntimeSessionChannel): void {
		if (this._kernel) {
			this._kernel.showOutput(channel);
		}
	}

	async showProfile(): Promise<void> {
		LOGGER.info('Profiler not yet implemented for Julia');
	}

	openResource(_resource: vscode.Uri | string): Thenable<boolean> {
		// TODO: Implement resource handling (help URIs, etc.)
		return Promise.resolve(false);
	}

	getDynState(): Thenable<positron.LanguageRuntimeDynState> {
		return Promise.resolve(this.dynState);
	}

	async debug(_request: positron.DebugProtocolRequest): Promise<positron.DebugProtocolResponse> {
		throw new Error('Debugging is not yet supported for Julia sessions');
	}

	async setWorkingDirectory(dir: string): Promise<void> {
		if (!this._kernel) {
			throw new Error('Session not started');
		}
		// Escape the directory path for Julia
		const escapedDir = dir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		this._kernel.execute(
			`cd("${escapedDir}")`,
			'setwd-' + Date.now(),
			positron.RuntimeCodeExecutionMode.Silent,
			positron.RuntimeErrorBehavior.Continue
		);
	}

	updateSessionName(name: string): void {
		this.dynState.sessionName = name;
	}
}
