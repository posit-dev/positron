/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { AuthMethod, AuthStatus } from './types.js';

/** Auth methods the source supports, OAuth first. */
export function availableAuthMethods(source: IPositronLanguageModelSource): AuthMethod[] {
	const methods: AuthMethod[] = [];
	if (source.supportedOptions.includes(AuthMethod.OAUTH)) {
		methods.push(AuthMethod.OAUTH);
	}
	if (source.supportedOptions.includes(AuthMethod.API_KEY)) {
		methods.push(AuthMethod.API_KEY);
	}
	return methods;
}

/**
 * The effective method: while signed in, the method the source reports it
 * actually connected with (source.authMethods, set by the extension from the
 * live session) takes precedence over guessing - a provider that supports
 * both OAuth and API key does not necessarily mean the current session used
 * either particular one. Otherwise, the user's in-progress selection when
 * supported, else the first available method.
 */
export function deriveAuthMethod(
	source: IPositronLanguageModelSource,
	selected?: AuthMethod,
): AuthMethod {
	if (source.signedIn && source.authMethods?.length) {
		const active = source.authMethods[0];
		if (active === AuthMethod.OAUTH || active === AuthMethod.API_KEY) {
			return active;
		}
	}
	const methods = availableAuthMethods(source);
	if (selected && methods.includes(selected)) {
		return selected;
	}
	return methods[0] ?? AuthMethod.NONE;
}

/** Derive the auth status from the source and transient UI state. */
export function deriveAuthStatus(
	source: IPositronLanguageModelSource,
	ui: { showProgress: boolean; apiKey?: string; selected?: AuthMethod },
): AuthStatus {
	if (source.signedIn) {
		return AuthStatus.SIGNED_IN;
	}
	if (ui.showProgress) {
		return AuthStatus.SIGNING_IN;
	}
	if (deriveAuthMethod(source, ui.selected) === AuthMethod.API_KEY && !!ui.apiKey && ui.apiKey.length > 0) {
		return AuthStatus.SIGN_IN_PENDING;
	}
	if (deriveAuthMethod(source, ui.selected) === AuthMethod.NONE) {
		return AuthStatus.SIGN_IN_PENDING;
	}
	return AuthStatus.SIGNED_OUT;
}

/** The onAction dispatch verb that connects the given provider. */
export function deriveConnectAction(source: IPositronLanguageModelSource, selected?: AuthMethod): string {
	return deriveAuthMethod(source, selected) === AuthMethod.OAUTH ? 'oauth-signin' : 'save';
}

/** The onAction dispatch verb that disconnects the given provider. */
export function deriveDisconnectAction(source: IPositronLanguageModelSource): string {
	return deriveAuthMethod(source) === AuthMethod.OAUTH ? 'oauth-signout' : 'delete';
}

/** Which modal view a selected provider routes to. */
export type ProviderView = 'connect' | 'connected';

/**
 * Select the appropriate modal view for a given provider source.
 */
export function selectProviderView(source: IPositronLanguageModelSource): ProviderView {
	// If the provider is in an error state, route to the connect view to allow re-authentication.
	if (source.status === 'error') {
		return 'connect';
	}

	if (source.signedIn) {
		return 'connected';
	}

	return 'connect';
}
