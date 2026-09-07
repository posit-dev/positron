/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthProvider } from './authProvider';

/**
 * The auth providers this extension has registered, keyed by auth provider ID.
 *
 * Used to answer diagnostics queries and to react to provider-catalog changes
 * (dropping sessions for a disabled provider, re-resolving a chain credential
 * whose connection settings changed).
 */
export const authProviders = new Map<string, AuthProvider>();

/** Record an auth provider so catalog reactions and diagnostics can find it. */
export function registerAuthProvider(
	providerId: string,
	provider: AuthProvider
): void {
	authProviders.set(providerId, provider);
}
