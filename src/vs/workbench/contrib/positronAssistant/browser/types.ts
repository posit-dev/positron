/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum AuthMethod {
	API_KEY = 'apiKey',
	OAUTH = 'oauth',
	NONE = 'none',
}

export enum AuthStatus {
	/** Currently signed in */
	SIGNED_IN = 'signedIn',
	/** User input entered, but not yet submitted for auth */
	SIGN_IN_PENDING = 'signInPending',
	/** Sign in submitted, waiting for response from auth process */
	SIGNING_IN = 'signingIn',
	/** Currently signed out */
	SIGNED_OUT = 'signedOut',
}

export enum ProviderTypeFilterOptions {
	ALL = 'all',
	CHAT = 'chat',
	COMPLETION = 'completion',
}
