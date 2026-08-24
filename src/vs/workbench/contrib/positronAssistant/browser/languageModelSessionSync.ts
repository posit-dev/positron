/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { POSITRON_CUSTOM_AUTH_PROVIDER_ID } from './customProviderCommands.js';

/**
 * Callback invoked when an auth session change affects a tracked provider.
 * @param providerId The provider whose session state changed.
 * @param signedIn Whether any sessions remain for the provider.
 */
export type SessionSyncCallback = (providerId: string, signedIn: boolean) => void;

/**
 * A provider to follow. A custom entry has to be marked as such: its sessions
 * live under one shared authentication provider, keyed by the entry name as a
 * scope, rather than under a provider of its own.
 */
export interface ISessionSyncTarget {
	readonly id: string;
	readonly custom?: boolean;
}

/**
 * Subscribe to authentication session changes for a set of providers.
 * When a session is added or removed for a matching provider, queries the
 * actual session count and invokes the callback with the result.
 *
 * @param authService The authentication service to listen to.
 * @param targets The providers to track.
 * @param callback Called with (providerId, signedIn) on relevant changes.
 * @returns A disposable that removes the listener.
 */
export function syncAuthSessions(
	authService: IAuthenticationService,
	targets: readonly ISessionSyncTarget[],
	callback: SessionSyncCallback,
): IDisposable {
	return authService.onDidChangeSessions(async (e) => {
		if (e.providerId === POSITRON_CUSTOM_AUTH_PROVIDER_ID) {
			// One provider serves every custom entry, so the event cannot say
			// which entry moved: ask each tracked entry for its own scope. By
			// scope, not by matching the event's account label, which would make
			// a display string load-bearing for identity.
			for (const target of targets) {
				if (!target.custom) {
					continue;
				}
				try {
					const sessions = await authService.getSessions(
						POSITRON_CUSTOM_AUTH_PROVIDER_ID, [target.id]);
					callback(target.id, sessions.length > 0);
				} catch {
					// Provider may not be registered yet
				}
			}
			return;
		}
		if (!targets.some(target => target.id === e.providerId && !target.custom)) {
			return;
		}
		try {
			const sessions = await authService.getSessions(e.providerId);
			callback(e.providerId, sessions.length > 0);
		} catch {
			// Provider may not be registered yet
		}
	});
}
