/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { RSession } from './session';

/**
 * Manages all the R sessions. We keep our own references to each session in a
 * singleton instance of this class so that we can invoke methods/check status
 * directly, without going through Positron's API.
 */
export class RSessionManager implements vscode.Disposable {
	/// Singleton instance
	private static _instance: RSessionManager;

	/// Disposables managed by the `RSessionManager`
	/// Note that these aren't currently ever disposed of because this is a singleton,
	/// but we may improve on this in the future so it is good practice to track them.
	private readonly _disposables: vscode.Disposable[] = [];

	/// Map of session IDs to RSession instances
	private _sessions: Map<string, RSession> = new Map();

	/// The most recent foreground R session (foreground implies it is a console session)
	private _lastForegroundSessionId: string | null = null;

	/// The last binpath that was used
	private _lastBinpath = '';

	/// Constructor; private since we only want one of these
	private constructor() {
		this._disposables.push(
			positron.runtime.onDidChangeForegroundSession(async sessionId => {
				await this.didChangeForegroundSession(sessionId);
			})
		);
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
		this._disposables.push(
			session.onDidChangeRuntimeState(async (state) => {
				await this.didChangeSessionRuntimeState(session, state);
			})
		);
	}

	private async didChangeSessionRuntimeState(session: RSession, state: positron.RuntimeState): Promise<void> {
		// Three `Ready` states to keep in mind:
		// - Fresh console sessions fall through and are activated by `didChangeForegroundSession()`.
		// - Restarted console sessions are activated here if they were previously the
		//   foreground session before their restart, as we won't get a foreground session
		//   notification for them otherwise.
		// - Notebook sessions are activated immediately (Background sessions never have their LSP activated).
		if (state === positron.RuntimeState.Ready) {
			if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
				if (this._lastForegroundSessionId === session.metadata.sessionId) {
					await this.activateConsoleSession(session, 'foreground session is ready');
				}
			} else if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Notebook) {
				await this.activateSession(session, 'notebook session is ready');
			}
		}
	}

	private async didChangeForegroundSession(sessionId: string | undefined): Promise<void> {
		if (!sessionId) {
			// There is no foreground session.
			return;
		}

		if (this._lastForegroundSessionId === sessionId) {
			// The foreground session has not changed.
			// This happens when we switch from R, to Python, and back to R, where the foreground
			// session for R hasn't changed.
			return;
		}

		// TODO: Switch to `getActiveRSessions()` built on `positron.runtime.getActiveSessions()`
		// and remove `this._sessions` entirely.
		const session = this._sessions.get(sessionId);
		if (!session) {
			// The foreground session is for another language.
			return;
		}

		if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Background) {
			throw Error(`Foreground session with ID ${sessionId} must not be a background session.`);
		}

		this._lastForegroundSessionId = session.metadata.sessionId;
		await this.activateConsoleSession(session, 'foreground session changed');
	}

	/**
	 * Activate a console session, while first deactivating all other console sessions
	 */
	private async activateConsoleSession(session: RSession, reason: string): Promise<void> {
		// Deactivate other console session servers first
		await Promise.all(Array.from(this._sessions.values())
			.filter(s => {
				return s.metadata.sessionId !== session.metadata.sessionId &&
					s.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console;
			})
			.map(s => {
				return this.deactivateSession(s, reason);
			})
		);
		await this.activateSession(session, reason);
	}

	/**
	 * Activates a session
	 *
	 * Does not request that other sessions deactivate. Used for notebook
	 * and background sessions, and indirectly for console sessions through
	 * the safer `activateConsoleSession()`.
	 */
	private async activateSession(session: RSession, reason: string): Promise<void> {
		await session.activateLsp(reason);
	}

	private async deactivateSession(session: RSession, reason: string): Promise<void> {
		await session.deactivateLsp(reason);
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
	 * Gets an R session by its session identifier.
	 *
	 * @param sessionId The session identifier
	 * @returns The R session, or undefined if not found
	 */
	getSessionById(sessionId: string): RSession | undefined {
		return this._sessions.get(sessionId);
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

	public dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
	}
}
