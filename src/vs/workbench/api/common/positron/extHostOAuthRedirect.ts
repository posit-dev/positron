/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogger } from '../../../../platform/log/common/log.js';
import { IExtHostUrlsService } from '../extHostUrls.js';

const vscodeDevAuthorities = new Set(['vscode.dev', 'insiders.vscode.dev']);

/** Returns the bare /callback URL for self-hosted web clients as the OAuth redirect_uri, or undefined for desktop and vscode.dev. */
export function getOAuthRedirectUri(appCallbackUri: URI): string | undefined {
	if (appCallbackUri.scheme !== 'https' && appCallbackUri.scheme !== 'http') {
		return undefined;
	}
	if (vscodeDevAuthorities.has(appCallbackUri.authority.toLowerCase())) {
		return undefined;
	}
	return appCallbackUri.with({ query: null, fragment: null }).toString(true);
}

export function parseAuthorizationCode(query: string): string {
	const codeMatch = /(?:^|[?&])code=([^&]+)/.exec(query);
	if (!codeMatch || codeMatch.length < 2) {
		throw new Error('Authentication failed: No authorization code received');
	}
	try {
		return decodeURIComponent(codeMatch[1]);
	} catch {
		return codeMatch[1];
	}
}

export async function getRegistrationRedirectUri(extHostUrls: IExtHostUrlsService, appUriScheme: string, logger: ILogger): Promise<string | undefined> {
	try {
		// vscode.github-authentication/dummy is upstream's escape hatch for
		// creating an app URI without registering a pending URL callback.
		const appUri = await extHostUrls.createAppUri(URI.parse(`${appUriScheme}://vscode.github-authentication/dummy`));
		return getOAuthRedirectUri(URI.from(appUri));
	} catch (err) {
		logger.warn(`Failed to resolve app callback URI for OAuth client registration: ${err}`);
		return undefined;
	}
}
