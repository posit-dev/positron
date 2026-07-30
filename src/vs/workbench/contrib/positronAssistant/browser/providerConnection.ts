/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { AuthMethod, AuthStatus } from './types.js';

/** Pick the single auth method a provider uses (OAuth wins over API key). */
export function deriveAuthMethod(source: IPositronLanguageModelSource): AuthMethod {
	if (source.supportedOptions.includes(AuthMethod.OAUTH)) {
		return AuthMethod.OAUTH;
	}
	if (source.supportedOptions.includes(AuthMethod.API_KEY)) {
		return AuthMethod.API_KEY;
	}
	return AuthMethod.NONE;
}

/** Derive the auth status from the source and transient UI state. */
export function deriveAuthStatus(
	source: IPositronLanguageModelSource,
	ui: { showProgress: boolean; apiKey?: string },
): AuthStatus {
	if (source.signedIn) {
		return AuthStatus.SIGNED_IN;
	}
	if (ui.showProgress) {
		return AuthStatus.SIGNING_IN;
	}
	if (deriveAuthMethod(source) === AuthMethod.API_KEY && !!ui.apiKey && ui.apiKey.length > 0) {
		return AuthStatus.SIGN_IN_PENDING;
	}
	if (deriveAuthMethod(source) === AuthMethod.NONE) {
		return AuthStatus.SIGN_IN_PENDING;
	}
	return AuthStatus.SIGNED_OUT;
}

/** The onAction dispatch verb that connects the given provider. */
export function deriveConnectAction(source: IPositronLanguageModelSource): string {
	return deriveAuthMethod(source) === AuthMethod.OAUTH ? 'oauth-signin' : 'save';
}

/** The onAction dispatch verb that disconnects the given provider. */
export function deriveDisconnectAction(source: IPositronLanguageModelSource): string {
	return deriveAuthMethod(source) === AuthMethod.OAUTH ? 'oauth-signout' : 'delete';
}

/** Which modal view a selected provider routes to. */
export type ProviderView = 'connect' | 'connected' | 'notSupported';

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
