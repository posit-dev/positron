/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AuthMethod, AuthStatus } from '../../browser/types.js';
import { availableAuthMethods, deriveAuthMethod, deriveAuthStatus, deriveConnectAction, deriveDisconnectAction, selectProviderView } from '../../browser/providerConnection.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

function source(overrides: Partial<IPositronLanguageModelSource> = {}): IPositronLanguageModelSource {
	const result: IPositronLanguageModelSource = {
		type: PositronLanguageModelType.Chat,
		provider: { id: 'posit-ai', displayName: 'Posit AI' },
		supportedOptions: ['oauth'],
		signedIn: false,
		defaults: {},
		...overrides,
	};
	return result;
}

describe('availableAuthMethods', () => {
	it('lists OAuth first when both are supported', () => {
		expect(availableAuthMethods(source({ supportedOptions: ['apiKey', 'oauth'] })))
			.toEqual([AuthMethod.OAUTH, AuthMethod.API_KEY]);
	});
	it('lists only API key when OAuth is unsupported', () => {
		expect(availableAuthMethods(source({ supportedOptions: ['apiKey'] }))).toEqual([AuthMethod.API_KEY]);
	});
	it('is empty when nothing is supported', () => {
		expect(availableAuthMethods(source({ supportedOptions: [] }))).toEqual([]);
	});
});

describe('deriveAuthMethod', () => {
	it('prefers OAuth', () => {
		expect(deriveAuthMethod(source({ supportedOptions: ['oauth', 'apiKey'] }))).toBe(AuthMethod.OAUTH);
	});
	it('falls back to API key', () => {
		expect(deriveAuthMethod(source({ supportedOptions: ['apiKey'] }))).toBe(AuthMethod.API_KEY);
	});
	it('is NONE when nothing supported', () => {
		expect(deriveAuthMethod(source({ supportedOptions: [] }))).toBe(AuthMethod.NONE);
	});
	it('honours a supported selection', () => {
		const withBoth = source({ supportedOptions: ['oauth', 'apiKey'] });
		expect(deriveAuthMethod(withBoth)).toBe(AuthMethod.OAUTH);
		expect(deriveAuthMethod(withBoth, AuthMethod.API_KEY)).toBe(AuthMethod.API_KEY);
	});
	it('ignores an unsupported selection', () => {
		expect(deriveAuthMethod(source({ supportedOptions: ['apiKey'] }), AuthMethod.OAUTH)).toBe(AuthMethod.API_KEY);
	});
	it('reports the actual connected method over the supported-options guess while signed in', () => {
		const connectedViaApiKey = source({
			supportedOptions: ['oauth', 'apiKey'],
			signedIn: true,
			authMethods: ['apiKey'],
		});
		expect(deriveAuthMethod(connectedViaApiKey)).toBe(AuthMethod.API_KEY);
	});
	it('falls back to the supported-options guess when signed in with no authMethods reported', () => {
		expect(deriveAuthMethod(source({ supportedOptions: ['oauth', 'apiKey'], signedIn: true }))).toBe(AuthMethod.OAUTH);
	});
	it('ignores authMethods while signed out', () => {
		const signedOutWithStaleAuthMethods = source({
			supportedOptions: ['oauth', 'apiKey'],
			signedIn: false,
			authMethods: ['apiKey'],
		});
		expect(deriveAuthMethod(signedOutWithStaleAuthMethods)).toBe(AuthMethod.OAUTH);
	});
});

describe('deriveAuthStatus', () => {
	it('is SIGNED_IN when the source is signed in', () => {
		expect(deriveAuthStatus(source({ signedIn: true }), { showProgress: false })).toBe(AuthStatus.SIGNED_IN);
	});
	it('is SIGNING_IN while progress is shown', () => {
		expect(deriveAuthStatus(source(), { showProgress: true })).toBe(AuthStatus.SIGNING_IN);
	});
	it('is SIGN_IN_PENDING when an API key is entered', () => {
		expect(deriveAuthStatus(source({ supportedOptions: ['apiKey'] }), { showProgress: false, apiKey: 'sk-x' })).toBe(AuthStatus.SIGN_IN_PENDING);
	});
	it('is SIGNED_OUT otherwise', () => {
		expect(deriveAuthStatus(source(), { showProgress: false })).toBe(AuthStatus.SIGNED_OUT);
	});
});

describe('deriveConnectAction', () => {
	it('signs in via oauth for an oauth provider', () => {
		expect(deriveConnectAction(source({ supportedOptions: ['oauth'] }))).toBe('oauth-signin');
	});
	it('saves for an api-key provider', () => {
		expect(deriveConnectAction(source({ supportedOptions: ['apiKey'] }))).toBe('save');
	});
	it('follows the selected method when both are supported', () => {
		const withBoth = source({ supportedOptions: ['oauth', 'apiKey'] });
		expect(deriveConnectAction(withBoth, AuthMethod.API_KEY)).toBe('save');
		expect(deriveConnectAction(withBoth, AuthMethod.OAUTH)).toBe('oauth-signin');
	});
});

describe('deriveDisconnectAction', () => {
	it('signs out via oauth for an oauth provider', () => {
		expect(deriveDisconnectAction(source({ supportedOptions: ['oauth'] }))).toBe('oauth-signout');
	});
	it('deletes for an api-key provider', () => {
		expect(deriveDisconnectAction(source({ supportedOptions: ['apiKey'] }))).toBe('delete');
	});
	it('deletes an API-key connection even when the provider also supports oauth', () => {
		const connectedViaApiKey = source({
			supportedOptions: ['oauth', 'apiKey'],
			signedIn: true,
			authMethods: ['apiKey'],
		});
		expect(deriveDisconnectAction(connectedViaApiKey)).toBe('delete');
	});
});

describe('selectProviderView', () => {
	it('routes a signed-in provider to the connected view regardless of type', () => {
		expect(selectProviderView(source({ provider: { id: 'amazon-bedrock', displayName: 'AWS' }, signedIn: true }))).toBe('connected');
	});
	it('routes a supported, signed-out provider to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'openai-api', displayName: 'OpenAI' }, signedIn: false }))).toBe('connect');
	});
	it('routes an unsupported, signed-out provider to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'amazon-bedrock', displayName: 'AWS' }, signedIn: false }))).toBe('connect');
	});
	it('routes GitHub Copilot to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'copilot-auth', displayName: 'GitHub Copilot' }, signedIn: false }))).toBe('connect');
	});
	it('routes Ollama to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'ollama', displayName: 'Ollama' }, signedIn: false }))).toBe('connect');
	});
	it('routes an errored provider to the connect view (to re-enter credentials)', () => {
		expect(selectProviderView(source({ provider: { id: 'amazon-bedrock', displayName: 'AWS' }, signedIn: false, status: 'error' }))).toBe('connect');
	});
});
