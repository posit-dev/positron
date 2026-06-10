/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogger } from '../../../../platform/log/common/log.js';
import { IExtHostUrlsService } from '../extHostUrls.js';

/**
 * Hosts whose OAuth redirects are handled by the dedicated
 * https://vscode.dev/redirect page rather than the web client's own
 * /callback route.
 */
const vscodeDevAuthorities = new Set(['vscode.dev', 'insiders.vscode.dev']);

/**
 * Derives a stable OAuth redirect URI from a resolved app callback URI.
 *
 * When running in a web client served from an arbitrary host (e.g. Posit
 * Workbench), app callback URIs resolve to the client's own /callback route
 * (`https://<host>/<base>/callback?vscode-reqid=N&...`). The route minus its
 * per-request query string is a stable URL that can be registered with an
 * authorization server and used as the OAuth `redirect_uri` directly; the
 * full callback URL travels in the OAuth `state` parameter and is unwrapped
 * by callback.html. This avoids the upstream `https://vscode.dev/redirect`
 * hop, which refuses to forward to hosts outside its allowlist
 * (https://github.com/posit-dev/positron/issues/13446).
 *
 * @param appCallbackUri An app URI resolved via `IExtHostUrlsService.createAppUri`.
 * @returns The bare callback URL, or `undefined` when the URI is not an
 *   http(s) URL on a self-hosted web client (desktop `positron://` URIs,
 *   vscode.dev deployments).
 */
export function getOAuthRedirectUri(appCallbackUri: URI): string | undefined {
	if (appCallbackUri.scheme !== 'https' && appCallbackUri.scheme !== 'http') {
		// Desktop app URIs (e.g. positron://...) are not reachable by an
		// authorization server redirect; the loopback flow handles desktop.
		return undefined;
	}
	if (vscodeDevAuthorities.has(appCallbackUri.authority.toLowerCase())) {
		// vscode.dev deployments keep using the upstream /redirect page.
		return undefined;
	}
	return appCallbackUri.with({ query: null, fragment: null }).toString(true);
}

/**
 * Resolves the web client's stable OAuth redirect URI for use in dynamic
 * client registration, where no per-request callback URI exists yet.
 *
 * @param extHostUrls Service used to resolve an app URI to the client's
 *   callback route.
 * @param appUriScheme The product URI scheme (`positron`).
 * @param logger Logger for resolution failures.
 * @returns The bare callback URL, or `undefined` when not running in a
 *   self-hosted web client or when resolution fails (callers fall back to
 *   the default registration redirect URIs).
 */
export async function getRegistrationRedirectUri(extHostUrls: IExtHostUrlsService, appUriScheme: string, logger: ILogger): Promise<string | undefined> {
	try {
		// The vscode.github-authentication/dummy URI is upstream's escape hatch
		// for creating an app URI without registering a pending URL callback in
		// the renderer (see LocalStorageURLCallbackProvider.create).
		const appUri = await extHostUrls.createAppUri(URI.parse(`${appUriScheme}://vscode.github-authentication/dummy`));
		return getOAuthRedirectUri(URI.from(appUri));
	} catch (err) {
		logger.warn(`Failed to resolve app callback URI for OAuth client registration: ${err}`);
		return undefined;
	}
}
