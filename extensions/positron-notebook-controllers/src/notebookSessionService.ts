/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { Uri } from 'vscode';
import { log } from './extension';
import { ResourceMap } from './map';
import { DeferredPromise } from './util';

/**
 * The notebook session service is the main interface for interacting with
 * runtime sessions; it manages the set of active sessions and provides
 * facilities for starting, stopping, and interacting with them.
 *
 * TODO(seem): The intention is for functionality here to eventually be brought into Positron core.
 */
export interface INotebookSessionService {
	/**
	 * Checks for a starting notebook for the given notebook URI.
	 *
	 * @param notebookUri The notebook URI to check for.
	 * @returns True if a starting notebook session exists for the given notebook URI.
	 */
	hasStartingNotebookSession(notebookUri: Uri): boolean;

	/**
	 * Checks for a starting or running notebook for the given notebook URI.
	 *
	 * @param notebookUri The notebook URI to check for.
	 * @returns True if a starting or running notebook session exists for the given notebook URI.
	 */
	hasStartingOrRunningNotebookSession(notebookUri: Uri): boolean;

	/**
	 * Get the starting or running notebook session for the given notebook URI, if one exists.
	 *
	 * @param notebookUri The notebook URI of the session to retrieve.
	 * @returns The starting or running notebook session for the given notebook URI, if one exists.
	 */
	getStartingNotebookSessionPromise(notebookUri: Uri): DeferredPromise<positron.LanguageRuntimeSession> | undefined;

	/**
	 * Get the running notebook session for the given notebook URI, if one exists.
	 *
	 * @param notebookUri The notebook URI of the session to retrieve.
	 * @returns The running notebook session for the given notebook URI, if one exists.
	 */
	getNotebookSession(notebookUri: Uri): positron.LanguageRuntimeSession | undefined;

	/**
	 * Start a new runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI to start a runtime for.
	 * @returns Promise that resolves when the runtime startup sequence has been started.
	 */
	startRuntimeSession(notebookUri: Uri, languageId: string): Promise<positron.LanguageRuntimeSession>;

	/**
	 * Shutdown the runtime session for a notebook.
	 *
	 * @param notebookUri The notebook URI whose runtime to shutdown.
	 * @returns Promise that resolves when the runtime shutdown sequence has been started.
	 */
	shutdownRuntimeSession(notebookUri: Uri): Promise<void>;

}

/**
 * The implementation of INotebookSessionService.
 */
export class NotebookSessionService implements INotebookSessionService {

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

	/** A map of the currently active notebook sessions, keyed by notebook URI. */
	private readonly _notebookSessionsByNotebookUri = new ResourceMap<positron.LanguageRuntimeSession>();

	hasStartingNotebookSession(notebookUri: Uri): boolean {
		return this._startingSessionsByNotebookUri.has(notebookUri);
	}

	hasStartingOrRunningNotebookSession(notebookUri: Uri): boolean {
		return this._startingSessionsByNotebookUri.has(notebookUri) || this._notebookSessionsByNotebookUri.has(notebookUri);
	}

	getStartingNotebookSessionPromise(notebookUri: Uri): DeferredPromise<positron.LanguageRuntimeSession> | undefined {
		return this._startingSessionsByNotebookUri.get(notebookUri);
	}

	getNotebookSession(notebookUri: Uri): positron.LanguageRuntimeSession | undefined {
		return this._notebookSessionsByNotebookUri.get(notebookUri);
	}

	async startRuntimeSession(notebookUri: Uri, languageId: string): Promise<positron.LanguageRuntimeSession> {
		// Return the existing promise, if there is one.
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			return startingSessionPromise.p;
		}

		// Update the starting sessions map. This needs to be set before any awaits in case another
		// caller tries to start a runtime or access the start promise concurrently.
		const startPromise = new DeferredPromise<positron.LanguageRuntimeSession>();
		this._startingSessionsByNotebookUri.set(notebookUri, startPromise);

		// If the notebook has a session that is still shutting down, wait for it to finish.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise && !shuttingDownSessionPromise.isSettled) {
			await shuttingDownSessionPromise.p;
		}

		// Ensure that we don't start a runtime for a notebook that already has one.
		if (this._notebookSessionsByNotebookUri.has(notebookUri)) {
			const err = new Error(`Tried to start a runtime for a notebook that already has one: ${notebookUri.path}`);
			startPromise.error(err);
			this._startingSessionsByNotebookUri.delete(notebookUri);
			throw err;
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
			startPromise.error(err);
			this._startingSessionsByNotebookUri.delete(notebookUri);
			throw err;
		}

		// If we couldn't restore a session, start a new one.
		if (!session) {
			// Get the preferred runtime for this language.
			let preferredRuntime: positron.LanguageRuntimeMetadata;
			try {
				preferredRuntime = await positron.runtime.getPreferredRuntime(languageId);
			} catch (err) {
				log.error(`Getting preferred runtime for language '${languageId}' failed. Reason: ${err}`);
				startPromise.error(err);
				this._startingSessionsByNotebookUri.delete(notebookUri);
				throw err;
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
				startPromise.error(err);
				this._startingSessionsByNotebookUri.delete(notebookUri);
				throw err;
			}
		}

		// Complete the promise and update the session maps.
		this._notebookSessionsByNotebookUri.set(notebookUri, session);
		this._startingSessionsByNotebookUri.delete(notebookUri);
		startPromise.complete(session);
		log.info(`Session ${session.metadata.sessionId} is ready`);

		return session;
	}

	async shutdownRuntimeSession(notebookUri: Uri): Promise<void> {
		// Return the existing promise, if there is one.
		const shuttingDownSessionPromise = this._shuttingDownSessionsByNotebookUri.get(notebookUri);
		if (shuttingDownSessionPromise && !shuttingDownSessionPromise.isSettled) {
			return shuttingDownSessionPromise.p;
		}

		// Update the shutting down sessions map. This needs to be set before any awaits in case
		// another caller tries to shutdown a runtime or access the shutdown promise concurrently.
		const shutDownPromise = new DeferredPromise<void>();
		this._shuttingDownSessionsByNotebookUri.set(notebookUri, shutDownPromise);

		// Get the notebook's session.
		let session: positron.LanguageRuntimeSession | undefined;
		const startingSessionPromise = this._startingSessionsByNotebookUri.get(notebookUri);
		if (startingSessionPromise && !startingSessionPromise.isSettled) {
			// If the runtime is still starting, wait for it to be ready.
			session = await startingSessionPromise.p;
		} else {
			// Try to get an already running session.
			session = this._notebookSessionsByNotebookUri.get(notebookUri);
		}

		// Ensure that we have a session.
		if (!session) {
			const err = new Error(`Tried to shutdown runtime for notebook without a running runtime: ${notebookUri.path}`);
			this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
			shutDownPromise.error(err);
			throw err;
		}

		// Start the shutdown sequence.
		try {
			await session.shutdown(positron.RuntimeExitReason.Shutdown);
			log.info(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path}`);
		} catch (err) {
			log.error(`Shutting down runtime ${session.runtimeMetadata.runtimeName} for notebook ${notebookUri.path} failed. Reason: ${err}`);
			this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
			this._notebookSessionsByNotebookUri.delete(notebookUri);
			shutDownPromise.error(err);
			throw err;
		}

		// Wait for the session to end. This is necessary so that we know when to start the next
		// session for the notebook, since at most one session can exist per notebook.
		try {
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
			await Promise.race([promise, timeout]);
		} catch (err) {
			log.error(err);
			this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
			this._notebookSessionsByNotebookUri.delete(notebookUri);
			shutDownPromise.error(err);
			throw err;
		}

		// Complete the promise and update the session maps.
		this._shuttingDownSessionsByNotebookUri.delete(notebookUri);
		this._notebookSessionsByNotebookUri.delete(notebookUri);
		shutDownPromise.complete();
		log.info(`Session ${session.metadata.sessionId} shutdown completed`);
	}

}
