/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { NullLogger } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostUrlsService } from '../../../common/extHostUrls.js';
import { getOAuthRedirectUri, getRegistrationRedirectUri } from '../../../common/positron/extHostOAuthRedirect.js';

describe('getOAuthRedirectUri', () => {
	it('returns the bare callback URL for a workbench https app URI', () => {
		const appUri = URI.parse('https://workbench.posit.it/releases-abc123/callback?vscode-reqid=4&vscode-scheme=positron&vscode-authority=dynamicauthprovider');
		expect(getOAuthRedirectUri(appUri)).toBe('https://workbench.posit.it/releases-abc123/callback');
	});

	it('returns the bare callback URL for an http localhost app URI', () => {
		const appUri = URI.parse('http://localhost:8080/callback?vscode-reqid=1');
		expect(getOAuthRedirectUri(appUri)).toBe('http://localhost:8080/callback');
	});

	it('strips fragments as well as query strings', () => {
		const appUri = URI.parse('https://workbench.posit.it/callback?vscode-reqid=2#fragment');
		expect(getOAuthRedirectUri(appUri)).toBe('https://workbench.posit.it/callback');
	});

	it('returns undefined for desktop app URIs', () => {
		const appUri = URI.parse('positron://dynamicauthprovider/mcp.example.com/authorize?nonce=abc');
		expect(getOAuthRedirectUri(appUri)).toBeUndefined();
	});

	it('returns undefined for vscode.dev', () => {
		const appUri = URI.parse('https://vscode.dev/callback?vscode-reqid=3');
		expect(getOAuthRedirectUri(appUri)).toBeUndefined();
	});

	it('returns undefined for insiders.vscode.dev', () => {
		const appUri = URI.parse('https://insiders.vscode.dev/callback?vscode-reqid=3');
		expect(getOAuthRedirectUri(appUri)).toBeUndefined();
	});

	it('matches vscode.dev hosts case-insensitively', () => {
		const appUri = URI.parse('https://VSCode.dev/callback?vscode-reqid=3');
		expect(getOAuthRedirectUri(appUri)).toBeUndefined();
	});
});

describe('getRegistrationRedirectUri', () => {
	const logger = new NullLogger();

	it('resolves an app URI and derives the redirect URI from it', async () => {
		const createAppUri = vi.fn().mockResolvedValue(URI.parse('https://workbench.posit.it/releases-abc123/callback?vscode-reqid=5'));
		const extHostUrls = stubInterface<IExtHostUrlsService>({ createAppUri });

		const redirectUri = await getRegistrationRedirectUri(extHostUrls, 'positron', logger);

		expect(redirectUri).toBe('https://workbench.posit.it/releases-abc123/callback');
		expect(createAppUri).toHaveBeenCalledWith(URI.parse('positron://vscode.github-authentication/dummy'));
	});

	it('returns undefined on desktop where app URIs use the product scheme', async () => {
		const extHostUrls = stubInterface<IExtHostUrlsService>({
			createAppUri: vi.fn().mockResolvedValue(URI.parse('positron://vscode.github-authentication/dummy')),
		});

		expect(await getRegistrationRedirectUri(extHostUrls, 'positron', logger)).toBeUndefined();
	});

	it('returns undefined when app URI resolution fails', async () => {
		const extHostUrls = stubInterface<IExtHostUrlsService>({
			createAppUri: vi.fn().mockRejectedValue(new Error('no URL handler')),
		});

		expect(await getRegistrationRedirectUri(extHostUrls, 'positron', logger)).toBeUndefined();
	});
});
