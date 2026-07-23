/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AuthMethod, AuthStatus } from '../../browser/types.js';
import { deriveAuthMethod, deriveAuthStatus, deriveConnectAction, deriveDisconnectAction, selectProviderView } from '../../browser/providerConnection.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

function source(overrides: Partial<IPositronLanguageModelSource> = {}): IPositronLanguageModelSource {
	const result: IPositronLanguageModelSource = {
		type: PositronLanguageModelType.Chat,
		provider: { id: 'posit-ai', displayName: 'Posit AI', settingName: 'posit-ai' },
		supportedOptions: ['oauth'],
		signedIn: false,
		defaults: {},
		...overrides,
	};
	return result;
}

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
});

describe('deriveDisconnectAction', () => {
	it('signs out via oauth for an oauth provider', () => {
		expect(deriveDisconnectAction(source({ supportedOptions: ['oauth'] }))).toBe('oauth-signout');
	});
	it('deletes for an api-key provider', () => {
		expect(deriveDisconnectAction(source({ supportedOptions: ['apiKey'] }))).toBe('delete');
	});
});

describe('selectProviderView', () => {
	it('routes a signed-in provider to the connected view regardless of type', () => {
		expect(selectProviderView(source({ provider: { id: 'amazon-bedrock', displayName: 'AWS', settingName: 'amazonBedrock' }, signedIn: true }))).toBe('connected');
	});
	it('routes a supported, signed-out provider to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'openai-api', displayName: 'OpenAI', settingName: 'openAI' }, signedIn: false }))).toBe('connect');
	});
	it('routes an unsupported, signed-out provider to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'amazon-bedrock', displayName: 'AWS', settingName: 'amazonBedrock' }, signedIn: false }))).toBe('connect');
	});
	it('routes GitHub Copilot to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'copilot-auth', displayName: 'GitHub Copilot', settingName: 'githubCopilot' }, signedIn: false }))).toBe('connect');
	});
	it('routes Ollama to the connect view', () => {
		expect(selectProviderView(source({ provider: { id: 'ollama', displayName: 'Ollama', settingName: 'ollama' }, signedIn: false }))).toBe('connect');
	});
	it('routes an errored provider to the connect view (to re-enter credentials)', () => {
		expect(selectProviderView(source({ provider: { id: 'amazon-bedrock', displayName: 'AWS', settingName: 'amazonBedrock' }, signedIn: false, status: 'error' }))).toBe('connect');
	});
});
