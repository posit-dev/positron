/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { RSession } from './session';

/**
 * Manages all the R sessions. We keep our own references to each session in a
 * singleton instance of this class so that we can invoke methods/check status
 * directly, without going through Positron's API.
 */
export class RSessionManager {
	/// Singleton instance
	private static _instance: RSessionManager;

	/// Map of session IDs to RSession instances
	private _sessions: Map<string, RSession> = new Map();

	/// The last binpath that was used
	private _lastBinpath = '';

	/// Constructor; private since we only want one of these
	private constructor() { }

	/**
	 * Accessor for the singleton instance; creates it if it doesn't exist.
	 */
	static get instance(): RSessionManager {
		if (!RSessionManager._instance) {
			RSessionManager._instance = new RSessionManager();
		}
		return RSessionManager._instance;
	}

	/**
	 * Gets the runtime with the given ID, if it's registered.
	 *
	 * @param id The ID of the runtime to get
	 * @returns The runtime. Throws an error if the runtime doesn't exist.
	 */
	getSession(sessionId: string): RSession {
		const session = this._sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found.`);
		}
		return session;
	}

	/**
	 * Registers a runtime with the manager. Throws an error if a runtime with
	 * the same ID is already registered.
	 *
	 * @param id The runtime's ID
	 * @param runtime The runtime.
	 */
	setSession(sessionId: string, session: RSession): void {
		if (this._sessions.has(sessionId)) {
			throw new Error(`Session ${sessionId} already registered.`);
		}
		this._sessions.set(sessionId, session);
	}

	/**
	 * Gets the R console session, if one is active.
	 *
	 * @returns The R console session, or undefined if there isn't one.
	 */
	getConsoleSession(): RSession | undefined {
		for (const session of this._sessions.values()) {
			if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
				return session;
			}
		}
	}

	/**
	 * Checks to see whether a session with the given ID is registered.
	 *
	 * @param id The ID of the session to check
	 * @returns Whether the session with the given ID is registered.
	 */
	hasSession(sessionId: string): boolean {
		return this._sessions.has(sessionId);
	}

	/**
	 * Sets the last observed R binary path.
	 *
	 * @param path The path to the R binary
	 */
	setLastBinpath(path: string) {
		this._lastBinpath = path;
	}

	/**
	 * Returns the last observed R binary path.
	 *
	 * @returns Whether we have a last observed R binary path.
	 */
	hasLastBinpath(): boolean {
		return this._lastBinpath !== '';
	}

	/**
	 * Returns the last observed R binary path.
	 */
	getLastBinpath(): string {
		return this._lastBinpath;
	}
}

