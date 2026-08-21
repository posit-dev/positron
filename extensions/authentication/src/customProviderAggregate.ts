/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { AuthProvider } from './authProvider';
import { log } from './log';

/**
 * One authentication provider serving every `providers.custom` entry, with the
 * entry name as the scope.
 *
 * One provider per entry cannot work. `trustedExtensionAuthAccess` in
 * product.json is keyed by authentication provider id, and a custom entry's id
 * is a name the user chose, so no static allowlist can contain it. Posit
 * Assistant's silent `getSession` for such an entry is refused with no error,
 * and the entry's models never reach the model picker. A statically named
 * provider can be allowlisted once, and the trust check ignores the account
 * entirely, so that one key covers every entry the user ever adds.
 *
 * No credential moves for this. Each entry keeps its own {@link AuthProvider},
 * constructed with the entry name, so its storage keys (`apiKey-<entry>-<id>`,
 * `auth.accounts.<entry>`) stay exactly where they were and there is nothing to
 * migrate. This class only routes, and it holds no credential of its own.
 */
export class CustomProviderAggregate
	implements vscode.AuthenticationProvider, vscode.Disposable {

	private readonly _onDidChangeSessions =
		new vscode.EventEmitter<
			vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
		>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private readonly delegates = new Map<string, Delegate>();

	/**
	 * Routes an entry's sessions through this provider, and reports whatever it
	 * already had as added. The entry name is the scope callers ask for.
	 */
	async addProvider(entryId: string, provider: AuthProvider): Promise<void> {
		// Subscribe first, and take the snapshot before the delegate is
		// reachable by any caller. An event that lands while `getSessions` is in
		// flight is then forwarded rather than dropped in the gap.
		const listener = provider.onDidChangeSessions(event =>
			this._onDidChangeSessions.fire(this.stampEvent(entryId, event)));
		const sessions = await provider.getSessions();
		this.delegates.set(entryId, { provider, listener });
		this._onDidChangeSessions.fire({
			added: this.stamp(entryId, sessions),
			removed: [],
			changed: [],
		});
	}

	/**
	 * Stops routing an entry, when its `providers.custom` entry is deleted or
	 * disabled, and reports its sessions as removed.
	 *
	 * Firing that is this class's job because nothing else can. Per-entry
	 * providers used to unregister for real, and the workbench drops a cached
	 * account on either the provider unregistering or a session change carrying
	 * `removed`. This provider stays registered, and `AuthProvider.dispose()`
	 * fires nothing (it sets a flag, stops its timer, and disposes its own
	 * emitter), so without this a deleted entry leaves a stale account in the
	 * Accounts menu until the window reloads.
	 */
	async removeProvider(entryId: string): Promise<void> {
		const delegate = this.delegates.get(entryId);
		if (!delegate) {
			return;
		}
		// Detach first, keeping the delegate object, because `getSessions` is
		// asynchronous. Read the final sessions while still subscribed and an
		// event landing in that window is forwarded as `added` and then left out
		// of `removed`, which is exactly the stale account this prevents.
		delegate.listener.dispose();
		const sessions = await delegate.provider.getSessions();
		this.delegates.delete(entryId);
		this._onDidChangeSessions.fire({
			added: [],
			removed: this.stamp(entryId, sessions),
			changed: [],
		});
	}

	/**
	 * No scopes means every entry's sessions, so the Accounts menu can list
	 * them. One scope means that entry.
	 *
	 * Anything else is `[]`. A credential lookup that cannot name a single
	 * entry has no answer, and returning the union would hand the caller a key
	 * belonging to some other endpoint.
	 */
	async getSessions(
		scopes: readonly string[] | undefined,
		options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession[]> {
		if (!scopes || scopes.length === 0) {
			const all: vscode.AuthenticationSession[] = [];
			for (const [entryId, delegate] of this.delegates) {
				all.push(...this.stamp(entryId, await delegate.provider.getSessions(undefined, options)));
			}
			return all;
		}
		if (scopes.length > 1) {
			return [];
		}
		const entryId = scopes[0];
		const delegate = this.delegates.get(entryId);
		if (!delegate) {
			return [];
		}
		return this.stamp(entryId, await delegate.provider.getSessions(undefined, options));
	}

	/**
	 * Sign in to one named entry, which prompts for its key.
	 *
	 * A call that names no entry, or more than one, has no sensible target, and
	 * the Accounts menu's own "add account" affordance passes no scopes at all.
	 * Say which entry is missing rather than picking one.
	 */
	async createSession(
		scopes: readonly string[],
		options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		if (scopes.length === 0) {
			throw new Error(vscode.l10n.t(
				'Adding a custom provider account here cannot tell which provider you mean. Use Configure LLM Providers instead.'
			));
		}
		if (scopes.length > 1) {
			throw new Error(vscode.l10n.t(
				'Signing in names exactly one custom provider, but {0} were given.', scopes.length
			));
		}
		const entryId = scopes[0];
		const delegate = this.delegates.get(entryId);
		if (!delegate) {
			throw new Error(vscode.l10n.t('No custom provider named "{0}" is registered.', entryId));
		}
		const session = await delegate.provider.createSession(scopes, options);
		return this.stampOne(entryId, session);
	}

	/**
	 * Session ids are random UUIDs, so the entry that owns one can be found by
	 * scanning and the answer is unambiguous.
	 */
	async removeSession(sessionId: string): Promise<void> {
		for (const delegate of this.delegates.values()) {
			const sessions = await delegate.provider.getSessions();
			if (sessions.some(session => session.id === sessionId)) {
				await delegate.provider.removeSession(sessionId);
				return;
			}
		}
		log.info(`No custom provider owns session ${sessionId}; nothing to remove.`);
	}

	dispose(): void {
		for (const delegate of this.delegates.values()) {
			delegate.listener.dispose();
		}
		this.delegates.clear();
		this._onDidChangeSessions.dispose();
	}

	/**
	 * Stamps the entry name on as the scope. `AuthProvider` mints `scopes: []`
	 * in every session it makes and is shared with the built-in providers, so
	 * the scope that identifies the entry is added here and nothing shared has
	 * to change.
	 */
	private stampOne(
		entryId: string,
		session: vscode.AuthenticationSession
	): vscode.AuthenticationSession {
		return { ...session, scopes: [entryId] };
	}

	private stamp(
		entryId: string,
		sessions: readonly vscode.AuthenticationSession[]
	): vscode.AuthenticationSession[] {
		return sessions.map(session => this.stampOne(entryId, session));
	}

	private stampEvent(
		entryId: string,
		event: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
	): vscode.AuthenticationProviderAuthenticationSessionsChangeEvent {
		return {
			added: this.stamp(entryId, event.added ?? []),
			removed: this.stamp(entryId, event.removed ?? []),
			changed: this.stamp(entryId, event.changed ?? []),
		};
	}
}

interface Delegate {
	readonly provider: AuthProvider;
	readonly listener: vscode.Disposable;
}
