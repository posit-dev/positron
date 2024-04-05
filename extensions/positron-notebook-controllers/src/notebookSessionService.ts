/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { Uri } from 'vscode';
import { log, setHasRunningNotebookSessionContext } from './extension';
import { ResourceMap } from './map';
import { DeferredPromise } from './util';

/**
 * The notebook session service is the main interface for interacting with
 * runtime sessions; it manages the set of active sessions and provides
 * facilities for starting, stopping, and interacting with them.
 *
 * TODO(seem): Most of this code is copied from the runtime session service. We should bring what's
 * required into the runtime session service and expose what's needed via the Positron Extensions
 * API.
 */
export class NotebookSessionService {

	/**
	 * A map of sessions currently starting, keyed by notebook URI. Values are promises that resolve
	 * when the session has started and is ready to execute code.
	 */
	private readonly _startingSessionsByNotebookUri = new ResourceMap<DeferredPromise<positron.LanguageRuntimeSession>>();

	/**
	 * A map of sessions currently shutting down, keyed by notebook URI. Values are promises that resolve
	 * when the session has completed the shutdown sequence.
	 */
	private readonly _shuttingDownSessionsByNotebookUri = new ResourceMap<DeferredPromise<void>>();

	/**
	 * A map of sessions currently restarting, keyed by notebook URI. Values are promises that resolve
	 * when the session has completed the restart sequence.
	 */
	private readonly _restartingSessionsByNotebookUri = new ResourceMap<DeferredPromise<positron.LanguageRuntimeSession>>();

	/** A map of the currently active notebook sessions, keyed by notebook URI. */
	private readonly _notebookSessionsByNotebookUri = new ResourceMap<positron.LanguageRuntimeSession>();

	/** A map of the current execution order, keyed by session ID. */
	private readonly _executionOrderBySessionId: Map<string, number> = new Map();

	/**
	 * Checks for a starting or running notebook for the given notebook URI.
	 *
	 * @param notebookUri The notebook URI to check for.
	 * @returns True if a starting or running notebook session exists for the given notebook URI.
	 */
	hasStartingOrRunningNotebookSession(notebookUri: Uri): boolean {
		return this._startingSessionsByNotebookUri.has(notebookUri) ||
			this._restartingSessionsByNotebookUri.has(notebookUri) ||
			this._notebookSessionsByNotebookUri.has(notebookUri);
	}

	/**
	 * Checks for a running notebook for the given notebook URI.
	 *
	 * @param notebookUri The notebook URI to check for.
	 * @returns True if a running notebook session exists for the given notebook URI.
	 */
	hasRunningNotebookSession(notebookUri: Uri): boolean {
		return this._notebookSessionsByNotebookUri.has(notebookUri);
	}

	/**
	 * Get the running notebook session for the given notebook URI, if one exists.
	 *
	 * @param notebookUri The notebook URI of the session to retrieve.
	 * @returns The running notebook session for the given notebook URI, if one exists.
	 */
	getNotebookSession(notebookUri: Uri): positron.LanguageRuntimeSession | undefined {
		return this._notebookSessionsByNotebookUri.get(notebookUri);
	}

	/**
	 * Get the execution order for a session.
	 *
	 * @param sessionId The session ID to get the execution order for.
	 * @returns The execution order for the session, if one exists.
	 */
	getExecutionOrder(sessionId: string): number | undefined {
		return this._executionOrderBySessionId.get(sessionId);
	}

	/**
	 * Set the execution order for a session.
	 *
	 * @param sessionId The session ID to set the execution order for.
	 * @param order The execution order to set.
	 */
	setExecutionOrder(sessionId: string, order: number): void {
		this._executionOrderBySessionId.set(sessionId, order);
	}

	/**
	 * Start a new runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI to start a runtime for.
	 * @returns Promise that resolves when the runtime startup sequence has been started.
	 */
	async startRuntimeSession(notebookUri: Uri, languageId: string): Promise<positron.LanguageRuntimeSession> {
		// Return the existing start promise, if there is one.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri) ||
			this._restartingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			return startingSessionPromise.p;
		}

		// Set the promise. This needs to be set before any awaits in case another
		// caller tries to start a runtime or access the start promise concurrently.
		const startPromise = new DeferredPromise<positron.LanguageRuntimeSession>();
		this._startingSessionsByNotebookUri.set(notebookUri, startPromise);

		// Helper function to error the promise and update the session maps.
		const error = (err: Error) => {
			this._startingSessionsByNotebookUri.delete(notebookUri);
			startPromise.error(err);
			return err;
		};

		// If the notebook's session that is still shutting down, wait for it to finish.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise && !shuttingDownSessionPromise.isSettled) {
			try {
				await shuttingDownSessionPromise.p;
			} catch (err) {
				log.error(`Waiting for notebook runtime to shutdown before starting failed. Reason ${err}`);
				throw error(err);
			}
		}

		// Ensure that we don't start a runtime for a notebook that already has one.
		if (this._notebookSessionsByNotebookUri.has(notebookUri)) {
			throw error(new Error(`Tried to start a runtime for a notebook that already has one: ${notebookUri.path}`));
		}

		// If there's already a session for this runtime e.g. one restored after a window reload, use it.
		let session: positron.LanguageRuntimeSession | undefined;
		try {
			session = await positron.runtime.getNotebookSession(notebookUri);
			if (session) {
				log.info(
					`Restored session for language runtime ${session.metadata.sessionId} `
					+ `(language: ${session.runtimeMetadata.languageName}, name: ${session.runtimeMetadata.runtimeName}, `
					+ `version: ${session.runtimeMetadata.runtimeVersion}, notebook: ${notebookUri.path})`
				);
			}
		} catch (err) {
			log.error(
				`Getting existing session for notebook ${notebookUri.path}' failed. Reason: ${err}`
			);
			throw error(err);
		}

		// TODO: If it isn't running, log an error and start a new one.
		// TODO: If it doesn't match the runtime ID, log an error, shut it down, and start a new one.

		// If we couldn't restore a session, start a new one.
		if (!session) {
			// Get the preferred runtime for this language.
			let preferredRuntime: positron.LanguageRuntimeMetadata;
			try {
				preferredRuntime = await positron.runtime.getPreferredRuntime(languageId);
			} catch (err) {
				log.error(`Getting preferred runtime for language '${languageId}' failed. Reason: ${err}`);
				throw error(err);
			}

			try {
				session = await positron.runtime.startLanguageRuntime(
					preferredRuntime.runtimeId,
					notebookUri.path, // Use the notebook's path as the session name.
					notebookUri);
				log.info(
					`Starting session for language runtime ${session.metadata.sessionId} `
					+ `(language: ${session.runtimeMetadata.languageName}, name: ${session.runtimeMetadata.runtimeName}, `
					+ `version: ${session.runtimeMetadata.runtimeVersion}, notebook: ${notebookUri.path})`
				);
			} catch (err) {
				log.error(`Starting session for language runtime ${preferredRuntime.runtimeName} failed. Reason: ${err}`);
				throw error(err);
			}
		}

		log.info(`Session ${session.metadata.sessionId} is ready`);

		this._notebookSessionsByNotebookUri.set(notebookUri, session);
		this._startingSessionsByNotebookUri.delete(notebookUri);
		setHasRunningNotebookSessionContext(true);
		startPromise.complete(session);

		return session;
	}

	/**
	 * Shutdown the runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI whose runtime to shutdown.
	 * @returns Promise that resolves when the runtime shutdown sequence has been started.
	 */
	async shutdownRuntimeSession(notebookUri: Uri): Promise<void> {
		// Return the existing promise, if there is one.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise && !shuttingDownSessionPromise.isSettled) {
			return shuttingDownSessionPromise.p;
		}

		// Set the promise. This needs to be set before any awaits in case another
		// another caller tries to shutdown a runtime or access the shutdown promise concurrently.
		const shutDownPromise = new DeferredPromise<void>();
		this._shuttingDownSessionsByNotebookUri.set(notebookUri, shutDownPromise);

		// Helper function to error the promise and update the session maps.
		const error = (err: Error) => {
			this._startingSessionsByNotebookUri.delete(notebookUri);
			shutDownPromise.error(err);
			return err;
		};

		// Get the notebook's session.
		let session = this._notebookSessionsByNotebookUri.get(notebookUri);

		if (!session) {
			// If the notebook's session that is still starting, wait for it to finish.
			const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri) ||
				this._restartingSessionsByNotebookUri.get(notebookUri);
			if (startingSessionPromise && !startingSessionPromise.isSettled) {
				try {
					session = await startingSessionPromise.p;
				} catch (err) {
					log.error(`Waiting for notebook runtime to start before shutting down failed. Reason ${err}`);
					throw error(err);
				}
			}
		}

		// Ensure that we have a session.
		if (!session) {
			throw error(new Error(`Tried to shutdown runtime for notebook without a running runtime: ${notebookUri.path}`));
		}

		// Start the shutdown sequence.
		try {
			log.info(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path}`);
			await session.shutdown(positron.RuntimeExitReason.Shutdown);
		} catch (err) {
			log.error(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path} failed. Reason: ${err}`);
			throw error(err);
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
			throw error(err);
		}

		log.info(`Session ${session.metadata.sessionId} is shutdown`);

		this._notebookSessionsByNotebookUri.delete(notebookUri);
		this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
		this._executionOrderBySessionId.delete(session.metadata.sessionId);
		shutDownPromise.complete();
	}

	async restartRuntimeSession(notebookUri: Uri): Promise<positron.LanguageRuntimeSession> {
		// Return the existing start, if there is one.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri) ||
			this._restartingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			return startingSessionPromise.p;
		}

		// Set the promise. This needs to be set before any awaits in case another
		// another caller tries to restart a runtime or access the restart promise concurrently.
		const restartPromise = new DeferredPromise<positron.LanguageRuntimeSession>();
		this._restartingSessionsByNotebookUri.set(notebookUri, restartPromise);
		setHasRunningNotebookSessionContext(false);

		// Helper function to error the promise and update the session maps.
		const error = (err: Error) => {
			this._restartingSessionsByNotebookUri.delete(notebookUri);
			restartPromise.error(err);
			return err;
		};

		// Get the notebook's session.
		const session = this._notebookSessionsByNotebookUri.get(notebookUri);
		if (!session) {
			throw error(new Error(`Tried to restart runtime for notebook without a running runtime: ${notebookUri.path}`));
		}

		// Remove the session from the map of active notebooks in case it's accessed while we're
		// restarting.
		this._notebookSessionsByNotebookUri.delete(notebookUri);

		// If the notebook's session is still shutting down, wait for it to finish.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise && !shuttingDownSessionPromise.isSettled) {
			try {
				await shuttingDownSessionPromise.p;
			} catch (err) {
				log.error(`Waiting for notebook runtime to shutdown before starting failed. Reason ${err}`);
				throw error(err);
			}
		}

		// Start the restart sequence.
		try {
			log.info(`Restarting session ${session.metadata.sessionId} for notebook ${notebookUri.path}`);
			await positron.runtime.restartSession(session.metadata.sessionId);
		} catch (err) {
			log.error(`Restarting session ${session.metadata.sessionId} for notebook ${notebookUri.path} failed. Reason: ${err}`);
			throw error(err);
		}

		// Wait for the session to be ready, or for a timeout.
		const timeout = new Promise<void>((_, reject) =>
			setTimeout(() => reject(new Error('Timeout waiting for runtime to restart')), 5000));
		const promise = new Promise<void>((resolve) => {
			const disposable = session.onDidChangeRuntimeState((state) => {
				if (state === positron.RuntimeState.Ready) {
					disposable.dispose();
					resolve();
				}
			});
		});
		try {
			await Promise.race([promise, timeout]);
		} catch (err) {
			log.error(err);
			throw error(err);
		}

		this._notebookSessionsByNotebookUri.set(notebookUri, session);
		this._restartingSessionsByNotebookUri.delete(notebookUri);
		this._executionOrderBySessionId.delete(session.metadata.sessionId);
		setHasRunningNotebookSessionContext(true);
		restartPromise.complete(session);
		log.info(`Session ${session.metadata.sessionId} is restarted`);

		return session;
	}
}
