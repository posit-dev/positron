/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react'
import { IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js'
import { localize } from '../../../../../nls.js'
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js'
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js'
import { LanguageModelUIConfiguration } from '../languageModelModalDialog.js'
import { AuthMethod } from '../types.js'

interface LanguageModelConfigComponentProps {
	authMethod: AuthMethod,
	provider: LanguageModelUIConfiguration,
	source: IPositronLanguageModelSource,
	signingIn?: boolean,
	onChange: (config: IPositronLanguageModelConfig) => void,
	onSignIn: () => void,
	onCancel: () => void,
}

type IProvider = IPositronLanguageModelSource['provider'];

const positEulaLabel = localize('positron.languageModelConfig.positEula', 'Posit EULA');
const completionsOnlyEmphasizedText = localize('positron.languageModelConfig.completionsOnly', 'code completions only');
const providerTermsOfServiceLabel = localize('positron.languageModelConfig.termsOfService', 'Terms of Service');
const providerPrivacyPolicyLabel = localize('positron.languageModelConfig.privacyPolicy', 'Privacy Policy');

function getProviderCompletionsOnlyNoticeText(providerDisplayName: string) {
	return localize(
		'positron.languageModelConfig.completionsOnlyNotice',
		'{0} functions for {code-completions-only} in Positron at this time.',
		providerDisplayName,
	);
}

function getProviderTermsOfServiceText(providerDisplayName: string) {
	return localize(
		'positron.languageModelConfig.tos',
		'{0} is considered "Third Party Materials" as defined in the {posit-eula} and subject to the {0} {provider-tos} and {provider-privacy-policy}.',
		providerDisplayName,
	);
}

function getProviderUsageDisclaimerText(providerDisplayName: string) {
	return localize(
		'positron.languageModelConfig.tos2',
		'Your use of {0} is optional and at your sole risk.',
		providerDisplayName,
	);
}

function getProviderTermsOfServiceLink(providerId: string) {
	switch (providerId) {
		case 'anthropic':
			return 'https://www.anthropic.com/legal/consumer-terms';
		case 'google':
			return 'https://cloud.google.com/terms/service-terms';
		case 'copilot':
			return 'https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot';
		default:
			return undefined;
	}
}

function getProviderPrivacyPolicyLink(providerId: string) {
	switch (providerId) {
		case 'anthropic':
			return 'https://www.anthropic.com/legal/privacy';
		case 'google':
			return 'https://policies.google.com/privacy';
		case 'copilot':
			return 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement#personal-data-we-collect';
		default:
			return undefined;
	}
}

function getProviderCompletionsOnlyNotice(provider: IProvider) {
	if (provider.id === 'copilot') {
		const text = getProviderCompletionsOnlyNoticeText(provider.displayName);
		return interpolate(
			text,
			(key) => key === 'code-completions-only' ?
				<strong>{completionsOnlyEmphasizedText}</strong> :
				undefined
		);
	}
	return undefined;
}

/**
 * Interpolates placeholders in a string with React nodes.
 *
 * Scans the input `text` for placeholders in the form `{key}` and replaces each with the result of the `value` function.
 * If `value(key)` returns `undefined`, the original placeholder is left in place.
 *
 * @param text The input string containing zero or more `{key}` placeholders.
 * @param value A function that takes a key and returns a React node to replace the corresponding placeholder, or `undefined` to leave it unchanged.
 * @returns An array of React nodes and strings representing the interpolated text.
 */
function interpolate(text: string, value: (key: string) => React.ReactNode | undefined): React.ReactNode[] {
	const nodes: React.ReactNode[] = [];
	let index = 0;
	for (const match of text.matchAll(/\{([^\}]+)\}/g)) {
		// Push text before the match, if any.
		if (index < match.index) {
			nodes.push(text.slice(index, match.index));
		}

		// Push the interpolated value, if there is one, or the original text.
		const key = match[1];
		const replacement = value(key) ?? match[0];
		nodes.push(replacement);

		// Bump the index.
		index = match.index + match[0].length;
	}

	// Push remaining text.
	if (index < text.length) {
		nodes.push(text.slice(index));
	}

	return nodes;
}

export const LanguageModelConfigComponent = (props: LanguageModelConfigComponentProps) => {
	const apiKeySpecified = props.source.supportedOptions.includes(AuthMethod.API_KEY) && !!props.provider.apiKey && props.provider.apiKey.length > 0;

	return <>
		<div className='language-model-container input'>
			{props.source.supportedOptions.includes('apiKey') && !props.source.signedIn && (
				<ApiKey apiKey={props.provider.apiKey} signedIn={props.source.signedIn} onChange={(newApiKey) => {
					props.onChange({ ...props.provider, apiKey: newApiKey });
				}} onSignIn={props.onSignIn} />
			)}
			<SignInButton apiKeySpecified={apiKeySpecified} authMethod={props.authMethod} signedIn={props.source.signedIn} signingIn={props.signingIn} onSignIn={props.onSignIn} />
			{
				props.signingIn && props.provider.oauth && !props.source.signedIn &&
				<Button className='language-model button cancel' onPressed={() => props.onCancel()}>
					{localize('positron.languageModelConfig.cancel', "Cancel")}
				</Button>
			}
		</div>
		<ProviderNotice provider={props.source.provider} />
	</>;
}

// Language config parts
const ApiKey = (props: { apiKey?: string, signedIn?: boolean, onChange: (newApiKey: string) => void, onSignIn: () => void }) => {
	return (<>
		<div className='language-model-authentication-container' id='api-key-input'>
			<LabeledTextInput
				disabled={props.signedIn}
				label={(() => localize('positron.languageModelConfig.apiKey', "API Key"))()}
				type='password'
				value={props.apiKey ?? ''}
				onChange={e => { props.onChange(e.currentTarget.value) }} />
		</div>
	</>)
}

const SignInButton = (props: { apiKeySpecified: boolean, authMethod: AuthMethod, signedIn?: boolean, signingIn?: boolean, onSignIn: () => void }) => {
	// When the auth method is 'apiKey' and the user is not signed in, we use the default button style, so that the
	// Enter key can be used to sign in with the text input provided.
	const useDefaultButtonStyle = props.authMethod === AuthMethod.API_KEY && props.apiKeySpecified && !props.signedIn;
	return <Button
		className={`language-model button sign-in ${useDefaultButtonStyle ? 'default' : ''}`}
		disabled={props.signingIn}
		onPressed={props.onSignIn}
	>
		{(() => {
			if (props.signedIn) {
				return localize('positron.languageModelConfig.signOut', "Sign out");
			} else {
				return localize('positron.languageModelConfig.signIn', "Sign in");
			}
		})()}
	</Button>
}

const ProviderNotice = (props: { provider: IProvider }) => {
	const completionsOnlyNotice = getProviderCompletionsOnlyNotice(props.provider);

	const termsOfServiceText = getProviderTermsOfServiceText(props.provider.displayName);
	const termsOfService = interpolate(
		termsOfServiceText,
		(key) => {
			switch (key) {
				case 'posit-eula':
					return <ExternalLink href='https://posit.co/about/eula/'>{positEulaLabel}</ExternalLink>;
				case 'provider-tos': {
					const link = getProviderTermsOfServiceLink(props.provider.id);
					return link ?
						<ExternalLink href={link}>{providerTermsOfServiceLabel}</ExternalLink> :
						providerTermsOfServiceLabel;
				}
				case 'provider-privacy-policy': {
					const link = getProviderPrivacyPolicyLink(props.provider.id);
					return link ?
						<ExternalLink href={link}>{providerPrivacyPolicyLabel}</ExternalLink> :
						providerPrivacyPolicyLabel;
				}
				default:
					return undefined;
			}
		},
	)

	const disclaimerText = getProviderUsageDisclaimerText(props.provider.displayName);

	return <div className='language-model-dialog-tos' id='model-tos'>
		{completionsOnlyNotice ? <p>{completionsOnlyNotice}</p> : null}
		<p>{termsOfService}</p>
		<p>{disclaimerText}</p>
	</div>;
}

const ExternalLink = (props: { href: string, children: React.ReactNode }) => {
	return <a href={props.href} rel='noreferrer' target='_blank'>
		{props.children}
	</a>;
}
