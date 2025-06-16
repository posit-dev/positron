/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum AuthMethod {
	API_KEY = 'apiKey',
	OAUTH = 'oauth',
}

export enum AuthStatus {
	SIGNED_IN = 'signedIn',
	IN_PROGRESS = 'inProgress',
	SIGNED_OUT = 'signedOut',
}
