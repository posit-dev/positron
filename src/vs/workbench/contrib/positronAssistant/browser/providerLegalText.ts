/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';

type IProvider = IPositronLanguageModelSource['provider'];

export const positEulaLabel = localize('positron.languageModelConfig.positEula', 'Posit EULA');
export const providerTermsOfServiceLabel = localize('positron.languageModelConfig.termsOfService', 'Terms of Service');
export const providerPrivacyPolicyLabel = localize('positron.languageModelConfig.privacyPolicy', 'Privacy Policy');

/**
 * Builds a markdown link fragment `[label](href)` for `EmbeddedLink`, or plain
 * label text when there's no URL (so the label still renders, just not linked).
 */
export function linkFragment(label: string, href: string | undefined): string {
	return href ? `[${label}](${href})` : label;
}

/**
 * Whether the legal text should talk about an endpoint the user configured rather
 * than a vendor: a `providers.custom` entry, or the built-in OpenAI-compatible
 * tile. A custom entry's display name is whatever the user typed, so naming it
 * as the party behind the terms ("your use of my anthropic") is wrong, and the
 * vendor its type borrows from needn't be who operates the endpoint.
 */
function isCustomProvider(provider: IProvider): boolean {
	return provider.id === 'openai-compatible' || provider.customKind !== undefined;
}

export function getProviderTermsOfServiceText(provider: IProvider) {
	const tos = linkFragment(providerTermsOfServiceLabel, getProviderTermsOfServiceLink(provider.id));
	const privacy = linkFragment(providerPrivacyPolicyLabel, getProviderPrivacyPolicyLink(provider.id));
	const eula = linkFragment(positEulaLabel, 'https://posit.co/about/eula/');
	if (isCustomProvider(provider)) {
		return localize(
			'positron.languageModelConfig.custom.tos',
			"A custom provider connects to an endpoint you configure, so its data handling and terms depend entirely on the provider you choose. Review that provider's own privacy policy and terms of service directly.",
		);
	}
	if (provider.id === 'posit-ai') {
		return localize(
			'positron.languageModelConfig.positAI.tos',
			'By using {0}, you agree to the {1}, {0} {2}, and {3}.',
			provider.displayName, eula, tos, privacy,
		);
	}
	return localize(
		'positron.languageModelConfig.tos',
		'{0} is considered "Third Party Materials" as defined in the {1} and subject to the {0} {2} and {3}.',
		provider.displayName, eula, tos, privacy,
	);
}

/**
 * An optional getting-started note shown before the terms of service.
 */
export function getProviderGettingStartedText(provider: IProvider): string | undefined {
	switch (provider.id) {
		case 'posit-ai': {
			const positAiHomeLink = linkFragment(
				localize('positron.languageModelConfig.positAiHome', 'Posit AI'),
				'https://posit.ai/',
			);
			return localize(
				'positron.languageModelConfig.positAI.gettingStartedNote',
				'Get started with Posit Assistant instantly via a free trial of {0}, a managed service that provides access to frontier LLMs through a single account. Posit AI provides access to both Posit Assistant and Next Edit Suggestions.',
				positAiHomeLink,
			);
		}
		default:
			return undefined;
	}
}

export function getProviderUsageDisclaimerText(provider: IProvider) {
	if (isCustomProvider(provider)) {
		return localize(
			'positron.languageModelConfig.custom.tos2',
			'Your use of this provider is optional and at your sole risk.',
		);
	}
	return localize(
		'positron.languageModelConfig.tos2',
		'Your use of {0} is optional and at your sole risk.',
		provider.displayName,
	);
}

export function getProviderTermsOfServiceLink(providerId: string) {
	switch (providerId) {
		case 'amazon-bedrock':
			return 'https://aws.amazon.com/service-terms/';
		case 'anthropic-api':
			return 'https://www.anthropic.com/legal/consumer-terms';
		case 'ms-foundry':
			return 'https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure';
		case 'google':
			return 'https://cloud.google.com/terms/service-terms';
		case 'copilot-auth':
			return 'https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot';
		case 'openai-api':
			return 'https://openai.com/policies/row-terms-of-use/';
		case 'posit-ai':
			return 'https://posit.co/about/posit-ai-agreement';
		case 'snowflake-cortex':
			return 'https://www.snowflake.com/en/legal/terms-of-service/';
		default:
			return undefined;
	}
}

export function getProviderPrivacyPolicyLink(providerId: string) {
	switch (providerId) {
		case 'amazon-bedrock':
			return 'https://aws.amazon.com/privacy/';
		case 'anthropic-api':
			return 'https://www.anthropic.com/legal/privacy';
		case 'ms-foundry':
			return 'https://privacy.microsoft.com/en-us/privacystatement';
		case 'google':
			return 'https://policies.google.com/privacy';
		case 'copilot-auth':
			return 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement#personal-data-we-collect';
		case 'openai-api':
			return 'https://openai.com/policies/row-privacy-policy/';
		case 'posit-ai':
			return 'https://posit.co/about/privacy-policy/';
		case 'snowflake-cortex':
			return 'https://www.snowflake.com/en/legal/privacy/privacy-policy/';
		default:
			return undefined;
	}
}
