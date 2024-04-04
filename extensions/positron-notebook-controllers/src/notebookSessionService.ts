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

	/**
	 * Checks for a starting or running notebook for the given notebook URI.
	 *
	 * @param notebookUri The notebook URI to check for.
	 * @returns True if a starting or running notebook session exists for the given notebook URI.
	 */
	hasStartingOrRunningNotebookSession(notebookUri: Uri): boolean {
		return this._startingSessionsByNotebookUri.has(notebookUri) || this._notebookSessionsByNotebookUri.has(notebookUri);
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
	 * Start a new runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI to start a runtime for.
	 * @returns Promise that resolves when the runtime startup sequence has been started.
	 */
	async startRuntimeSession(notebookUri: Uri, languageId: string): Promise<positron.LanguageRuntimeSession> {
		// Return the existing promise, if there is one.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			return startingSessionPromise.p;
		}

		// Set the promise. This needs to be set before any awaits in case another
		// caller tries to start a runtime or access the start promise concurrently.
		const startPromise = new DeferredPromise<positron.LanguageRuntimeSession>();
		this._startingSessionsByNotebookUri.set(notebookUri, startPromise);

		// Helper function to complete the promise and update the session maps.
		const complete = (session: positron.LanguageRuntimeSession) => {
			this._notebookSessionsByNotebookUri.set(notebookUri, session);
			this._startingSessionsByNotebookUri.delete(notebookUri);
			setHasRunningNotebookSessionContext(true);
			startPromise.complete(session);
			return session;
		};

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

		// If the notebook's session is still restarting, wait for it to finish.
		const restartingSessionPromise = this._restartingSessionsByNotebookUri.get(notebookUri);
		if (restartingSessionPromise && !restartingSessionPromise.isSettled) {
			let session: positron.LanguageRuntimeSession;
			try {
				session = await restartingSessionPromise.p;
			} catch (err) {
				log.error(`Waiting for notebook runtime to restart before starting failed. Reason ${err}`);
				throw error(err);
			}
			// No need to start a new session if we just restarted, exit early.
			return complete(session);
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

		return complete(session);
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

		// Helper function to complete the promise and update the session maps.
		const complete = () => {
			this._notebookSessionsByNotebookUri.delete(notebookUri);
			this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
			shutDownPromise.complete();
		};

		// Helper function to error the promise and update the session maps.
		const error = (err: Error) => {
			this._startingSessionsByNotebookUri.delete(notebookUri);
			shutDownPromise.error(err);
			return err;
		};

		// If the notebook's session that is still shutting down, wait for it to finish.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			try {
				await startingSessionPromise.p;
			} catch (err) {
				log.error(`Waiting for notebook runtime to start before shutting down failed. Reason ${err}`);
				throw error(err);
			}
		}

		// If the notebook's session that is still restarting, wait for it to finish.
		const restartingSessionPromise = this._restartingSessionsByNotebookUri.get(notebookUri);
		if (restartingSessionPromise && !restartingSessionPromise.isSettled) {
			try {
				await restartingSessionPromise.p;
			} catch (err) {
				log.error(`Waiting for notebook runtime to restart before shutting down failed. Reason ${err}`);
				throw error(err);
			}
		}

		// Get the notebook's session.
		const session = this._notebookSessionsByNotebookUri.get(notebookUri);

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

		return complete();
	}

	async restartRuntimeSession(notebookUri: Uri): Promise<positron.LanguageRuntimeSession> {
		// Return the existing promise, if there is one.
		const restartingSessionPromise = this._restartingSessionsByNotebookUri.get(notebookUri);
		if (restartingSessionPromise && !restartingSessionPromise.isSettled) {
			return restartingSessionPromise.p;
		}

		// Set the promise. This needs to be set before any awaits in case another
		// another caller tries to shutdown a runtime or access the shutdown promise concurrently.
		const restartPromise = new DeferredPromise<positron.LanguageRuntimeSession>();
		this._restartingSessionsByNotebookUri.set(notebookUri, restartPromise);
		setHasRunningNotebookSessionContext(false);

		// Helper function to complete the promise and update the session maps.
		const complete = (session: positron.LanguageRuntimeSession) => {
			this._notebookSessionsByNotebookUri.set(notebookUri, session);
			this._restartingSessionsByNotebookUri.delete(notebookUri);
			setHasRunningNotebookSessionContext(true);
			restartPromise.complete(session);
			return session;
		};

		// Helper function to error the promise and update the session maps.
		const error = (err: Error) => {
			this._restartingSessionsByNotebookUri.delete(notebookUri);
			restartPromise.error(err);
			return err;
		};

		// If the notebook's session that is still shutting down, wait for it to finish.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			let session: positron.LanguageRuntimeSession;
			try {
				session = await startingSessionPromise.p;
			} catch (err) {
				log.error(`Waiting for notebook runtime to restart before starting failed. Reason ${err}`);
				throw error(err);
			}
			// No need to restart the session if we just started, exit early.
			return complete(session);
		}

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

		// Get the notebook's session.
		const session = this._notebookSessionsByNotebookUri.get(notebookUri);
		if (!session) {
			throw error(new Error(`Tried to restart runtime for notebook without a running runtime: ${notebookUri.path}`));
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

		log.info(`Session ${session.metadata.sessionId} is restarted`);

		return complete(session);
	}
}
