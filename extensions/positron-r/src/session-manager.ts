/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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

	/// The most recent foreground R session (foreground implies it is a console session)
	private _lastForegroundSessionId: string | null = null;

	/// The set of sessions actively restarting
	private _restartingConsoleSessionIds: Set<string> = new Set();

	/// The last binpath that was used
	private _lastBinpath = '';

	/// Constructor; private since we only want one of these
	private constructor() {
		positron.runtime.onDidChangeForegroundSession(async sessionId => {
			await this.didChangeForegroundSession(sessionId);
		});
	}

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
		session.onDidChangeRuntimeState(async (state) => {
			await this.didChangeSessionRuntimeState(session, state);
		})
	}

	private async didChangeSessionRuntimeState(session: RSession, state: positron.RuntimeState): Promise<void> {
		switch (state) {
			// Three `Ready` states to consider:
			// - Fresh console sessions fall through and are activated by `didChangeForegroundSession()`.
			// - Restarted console sessions are activated here if they were previously the
			//   foreground session before their restart, as we won't get a foreground session
			//   notification for them otherwise.
			// - Non-console sessions are activated immediately.
			case positron.RuntimeState.Ready: {
				if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
					if (this._restartingConsoleSessionIds.has(session.metadata.sessionId)) {
						this._restartingConsoleSessionIds.delete(session.metadata.sessionId);
						if (this._lastForegroundSessionId === session.metadata.sessionId) {
							await this.activateConsoleSession(session);
						}
					}
				} else {
					await this.activateSession(session);
				}
				break;
			}

			// Track Console session restarts for potential reactivation once
			// the session is ready. Ideally we'd use `RuntimeState.Restarting`
			// to only track truly restarting sessions, but kallichore doesn't
			// emit that right now. The practical downside of this is that
			// sessions that permanently go into `Exited` and never come back
			// online will never be removed from `_restartingConsoleSessionIds`,
			// but we don't think that would get too out of control.
			case positron.RuntimeState.Exited: {
				if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
					this._restartingConsoleSessionIds.add(session.metadata.sessionId);
				}
			}

			default:
				break;
		}
	}

	private async didChangeForegroundSession(sessionId: string | undefined): Promise<void> {
		if (!sessionId) {
			// There is no foreground session, nothing to do.
			return;
		}

		// TODO: Switch to `getActiveRSessions()` built on `positron.runtime.getActiveSessions()`
		// and remove `this._sessions` entirely.
		const session = this._sessions.get(sessionId)
		if (!session) {
			// The foreground session is for another language.
			return;
		}

		if (session.metadata.sessionMode !== positron.LanguageRuntimeSessionMode.Console) {
			throw Error(`Foreground session with ID ${sessionId} must be a console session.`);
		}

		this._lastForegroundSessionId = session.metadata.sessionId;
		await this.activateConsoleSession(session);
	}

	/**
	 * Activate a console session, while first deactivating all other console sessions
	 */
	private async activateConsoleSession(session: RSession): Promise<void> {
		// Deactivate other console session servers first
		await Promise.all(Array.from(this._sessions.values())
			.filter(s => {
				return s.metadata.sessionId !== session.metadata.sessionId &&
					s.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console
			})
			.map(s => {
				return this.deactivateSession(s);
			})
		);
		await this.activateSession(session);
	}

	/**
	 * Activates a session
	 *
	 * Does not request that other sessions deactivate. Used for notebook
	 * and background sessions, and indirectly for console sessions through
	 * the safer `activateConsoleSession()`.
	 */
	private async activateSession(session: RSession): Promise<void> {
		await session.activateLsp();
	}

	private async deactivateSession(session: RSession): Promise<void> {
		await session.deactivateLsp();
	}

	/**
	 * Gets the R console session, if one is active.
	 *
	 * @returns The R console session, or undefined if there isn't one.
	 */
	getConsoleSession(): RSession | undefined {
		// Sort the sessions by creation time (descending)
		const sessions = Array.from(this._sessions.values());
		sessions.sort((a, b) => b.created - a.created);

		// Remove any sessions that aren't console sessions and have either
		// never started or have exited
		const consoleSessions = sessions.filter(s =>
			s.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console &&
			s.state !== positron.RuntimeState.Uninitialized &&
			s.state !== positron.RuntimeState.Exited);

		// No console sessions
		if (consoleSessions.length === 0) {
			return undefined;
		}

		// We would not expect to see more than one console session since
		// Positron currently only allows one console session per language. If
		// this constraint is relaxed in the future, we can remove this warning.
		if (consoleSessions.length > 1) {
			console.warn(`${consoleSessions.length} R console sessions found; ` +
				`returning the most recently started one.`);
		}

		return consoleSessions[0];
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
