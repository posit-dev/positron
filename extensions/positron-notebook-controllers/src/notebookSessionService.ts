/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as path from 'path';
import { log } from './extension';
import { ResourceMap } from './map';

export interface INotebookSessionDidChangeEvent {
	/** The URI of the notebook corresponding to the session. */
	readonly notebookUri: vscode.Uri;

	/** The session that was set for the notebook, or undefined if it was deleted. */
	readonly session?: positron.LanguageRuntimeSession;
}

/**
 * The notebook session service is the main interface for interacting with
 * runtime sessions; it manages the set of active sessions and provides
 * facilities for starting, stopping, and interacting with them.
 *
 * TODO(seem): Most of this code is copied from the runtime session service. We should bring what's
 * required into the runtime session service and expose what's needed via the Positron Extensions
 * API.
 */
export class NotebookSessionService implements vscode.Disposable {
	private readonly _disposables = new Array<vscode.Disposable>();

	/**
	 * A map of sessions currently starting, keyed by notebook URI. Values are promises that resolve
	 * when the session has started and is ready to execute code.
	 */
	private readonly _startingSessionsByNotebookUri = new ResourceMap<Promise<positron.LanguageRuntimeSession>>();

	/**
	 * A map of sessions currently shutting down, keyed by notebook URI. Values are promises that resolve
	 * when the session has completed the shutdown sequence.
	 */
	private readonly _shuttingDownSessionsByNotebookUri = new ResourceMap<Promise<void>>();

	/**
	 * A map of sessions currently restarting, keyed by notebook URI. Values are promises that resolve
	 * when the session has completed the restart sequence.
	 */
	private readonly _restartingSessionsByNotebookUri = new ResourceMap<Promise<positron.LanguageRuntimeSession>>();

	/** The event emitter for the onDidChangeNotebookSession event. */
	private readonly _onDidChangeNotebookSession = this._register(new vscode.EventEmitter<INotebookSessionDidChangeEvent>);

	/** An event that fires when a session is set/unset for a notebook. */
	readonly onDidChangeNotebookSession = this._onDidChangeNotebookSession.event;

	private _register<T extends vscode.Disposable>(disposable: T): T {
		this._disposables.push(disposable);
		return disposable;
	}

	/**
	 * Checks for a starting or running notebook for the given notebook URI.
	 *
	 * @param notebookUri The notebook URI to check for.
	 * @returns True if a starting or running notebook session exists for the given notebook URI.
	 */
	hasStartingOrRunningNotebookSession(notebookUri: vscode.Uri): boolean {
		return this._startingSessionsByNotebookUri.has(notebookUri) ||
			this._restartingSessionsByNotebookUri.has(notebookUri) ||
			positron.runtime.getNotebookSession(notebookUri) !== undefined;
	}

	/**
	 * Wait for a notebook session to complete a shutdown sequence.
	 *
	 * @param notebookUri The notebook URI to wait for.
	 * @returns A promise that resolves when the session has completed the shutdown sequence.
	 */
	async waitForNotebookSessionToShutdown(notebookUri: vscode.Uri): Promise<void> {
		await this._shuttingDownSessionsByNotebookUri.get(notebookUri);
	}

	/**
	 * Wait for a notebook session to complete a restart sequence.
	 *
	 * @param notebookUri The notebook URI to wait for.
	 * @returns A promise that resolves when the session has completed the restart sequence.
	 */
	async waitForNotebookSessionToRestart(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession> {
		const restartingSessionPromise = this._restartingSessionsByNotebookUri.get(notebookUri);
		if (!restartingSessionPromise) {
			throw new Error(`No session is restarting for notebook ${notebookUri.path}`);
		}
		return restartingSessionPromise;
	}

	/**
	 * Start a new runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI to start a runtime for.
	 * @param runtimeId The language runtime ID to start.
	 * @returns Promise that resolves when the runtime startup sequence has been started.
	 */
	async startRuntimeSession(notebookUri: vscode.Uri, runtimeId: string): Promise<positron.LanguageRuntimeSession> {
		// Return the existing promise, if there is one.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri) ||
			this._restartingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise) {
			return startingSessionPromise;
		}

		// Construct a wrapping promise that resolves/rejects after the session maps have been updated.
		const startPromise = (async () => {
			try {
				const session = await this.doStartRuntimeSession(notebookUri, runtimeId);
				this._startingSessionsByNotebookUri.delete(notebookUri);
				this._onDidChangeNotebookSession.fire({ notebookUri, session });
				log.info(`Session ${session.metadata.sessionId} is started`);
				return session;
			} catch (err) {
				this._startingSessionsByNotebookUri.delete(notebookUri);
				throw err;
			}
		})();

		this._startingSessionsByNotebookUri.set(notebookUri, startPromise);

		return startPromise;
	}

	async doStartRuntimeSession(notebookUri: vscode.Uri, runtimeId: string): Promise<positron.LanguageRuntimeSession> {
		// If the session is still shutting down, wait for it to finish.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise) {
			try {
				await shuttingDownSessionPromise;
			} catch (err) {
				log.error(`Waiting for notebook runtime to shutdown before starting failed. Reason ${err}`);
				throw err;
			}
		}

		// Start the session.
		try {
			const session = await positron.runtime.startLanguageRuntime(
				runtimeId,
				path.basename(notebookUri.path), // Use the notebook's file name as the session name.
				notebookUri);
			log.info(
				`Starting session for language runtime ${session.metadata.sessionId} `
				+ `(language: ${session.runtimeMetadata.languageName}, name: ${session.runtimeMetadata.runtimeName}, `
				+ `version: ${session.runtimeMetadata.runtimeVersion}, notebook: ${notebookUri.path})`
			);
			return session;
		} catch (err) {
			log.error(`Starting session for language runtime ${runtimeId} failed. Reason: ${err}`);
			throw err;
		}
	}

	/**
	 * Shutdown the runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI whose runtime to shutdown.
	 * @returns Promise that resolves when the runtime shutdown sequence has been started.
	 */
	async shutdownRuntimeSession(notebookUri: vscode.Uri): Promise<void> {
		// Return the existing promise, if there is one.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise) {
			return shuttingDownSessionPromise;
		}

		// Construct a wrapping promise that resolves/rejects after the session maps have been updated.
		const shutdownPromise = (async () => {
			try {
				await this.doShutdownRuntimeSession(notebookUri);
				this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
				this._onDidChangeNotebookSession.fire({ notebookUri, session: undefined });
			} catch (err) {
				this._startingSessionsByNotebookUri.delete(notebookUri);
				throw err;
			}
		})();

		this._shuttingDownSessionsByNotebookUri.set(notebookUri, shutdownPromise);

		return shutdownPromise;
	}

	async doShutdownRuntimeSession(notebookUri: vscode.Uri): Promise<void> {
		// Get the notebook's session.
		const session = await this.getExistingOrPendingSession(notebookUri);
		if (!session) {
			log.debug(`Tried to shutdown runtime for notebook without a running or starting runtime: ${notebookUri.path}`);
			return;
		}

		// Start the shutdown sequence.
		try {
			log.info(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path}`);
			await session.shutdown(positron.RuntimeExitReason.Shutdown);
		} catch (err) {
			log.error(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path} failed. Reason: ${err}`);
			throw err;
		}

		// Wait for the session to end. This is necessary so that we know when to start the next
		// session for the notebook, since at most one session can exist per notebook.
		const timeout = new Promise<void>((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path} timed out`));
			}, 5000);
		});
		const promise = new Promise<void>(resolve => {
			const disposable = session.onDidEndSession(() => {
				disposable.dispose();
				resolve();
			});
		});
		try {
			await Promise.race([promise, timeout]);
		} catch (err) {
			log.error(err);
			throw err;
		}

		log.info(`Session ${session.metadata.sessionId} is shutdown`);
	}

	private async getExistingOrPendingSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession | undefined> {
		// Check for an active session first.
		const activeSession = await positron.runtime.getNotebookSession(notebookUri);
		if (activeSession) {
			return activeSession;
		}

		// Check for a pending session.
		const pendingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri) ||
			this._restartingSessionsByNotebookUri.get(notebookUri);
		if (pendingSessionPromise) {
			try {
				return await pendingSessionPromise;
			} catch (err) {
				// No need to log; the error will be handled elsewhere.
			}
		}

		// There is no existing or pending session for the notebook.
		return undefined;
	}

	/**
	 * Restart a runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI to restart a runtime for.
	 * @returns Promise that resolves when the runtime restart sequence has completed and the
	 *  session is enters the ready state.
	 */
	async restartRuntimeSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession> {
		// Return the existing promise, if there is one.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri) ||
			this._restartingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise) {
			return startingSessionPromise;
		}

		// Construct a wrapping promise that resolves/rejects after the session maps have been updated.
		const restartPromise = (async () => {
			try {
				const session = await this.doRestartRuntimeSession(notebookUri);
				this._restartingSessionsByNotebookUri.delete(notebookUri);
				this._onDidChangeNotebookSession.fire({ notebookUri, session });
				log.info(`Session ${session.metadata.sessionId} is restarted`);
				return session;
			} catch (err) {
				this._restartingSessionsByNotebookUri.delete(notebookUri);
				throw err;
			}
		})();

		this._restartingSessionsByNotebookUri.set(notebookUri, restartPromise);

		return restartPromise;
	}

	async doRestartRuntimeSession(notebookUri: vscode.Uri): Promise<positron.LanguageRuntimeSession> {
		// Get the notebook's session.
		const session = await positron.runtime.getNotebookSession(notebookUri);
		if (!session) {
			throw new Error(`Tried to restart runtime for notebook without a running runtime: ${notebookUri.path}`);
		}

		// Remove the session from the map of active notebooks in case it's accessed while we're
		// restarting.
		this._onDidChangeNotebookSession.fire({ notebookUri, session: undefined });

		// If the notebook's session is still shutting down, wait for it to finish.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise) {
			try {
				await shuttingDownSessionPromise;
			} catch (err) {
				log.error(`Waiting for notebook runtime to shutdown before starting failed. Reason ${err}`);
				throw err;
			}
		}

		// Create a promise that resolves when the session is ready.
		const promise = new Promise<void>((resolve) => {
			const disposable = session.onDidChangeRuntimeState((state) => {
				if (state === positron.RuntimeState.Ready) {
					disposable.dispose();
					resolve();
				}
			});
		});

		// Start the restart sequence.
		try {
			log.info(`Restarting session ${session.metadata.sessionId} for notebook ${notebookUri.path}`);
			await positron.runtime.restartSession(session.metadata.sessionId);
		} catch (err) {
			log.error(`Restarting session ${session.metadata.sessionId} for notebook ${notebookUri.path} failed. Reason: ${err}`);
			throw err;
		}

		// Wait for the session to be ready, or for a timeout.
		const timeout = new Promise<void>((_, reject) =>
			setTimeout(() => reject(new Error('Timeout waiting for runtime to restart')), 5000));
		try {
			await Promise.race([promise, timeout]);
		} catch (err) {
			log.error(err);
			throw err;
		}

		return session;
	}

	dispose() {
		this._disposables.forEach(d => d.dispose());
	}
}
