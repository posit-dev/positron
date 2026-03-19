/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';

/**
 * Callback invoked when an auth session change affects a tracked provider.
 * @param providerId The provider whose session state changed.
 * @param signedIn Whether any sessions remain for the provider.
 */
export type SessionSyncCallback = (providerId: string, signedIn: boolean) => void;

/**
 * Subscribe to authentication session changes for a set of provider IDs.
 * When a session is added or removed for a matching provider, queries the
 * actual session count and invokes the callback with the result.
 *
 * @param authService The authentication service to listen to.
 * @param providerIds The provider IDs to track.
 * @param callback Called with (providerId, signedIn) on relevant changes.
 * @returns A disposable that removes the listener.
 */
export function syncAuthSessions(
	authService: IAuthenticationService,
	providerIds: string[],
	callback: SessionSyncCallback,
): IDisposable {
	return authService.onDidChangeSessions(async (e) => {
		if (!providerIds.includes(e.providerId)) {
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
