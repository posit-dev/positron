/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react'
import { IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js'
import { localize } from '../../../../../nls.js'
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js'
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js'
import { AuthMethod, AuthStatus } from '../types.js'

interface LanguageModelConfigComponentProps {
	authMethod: AuthMethod,
	authStatus: AuthStatus,
	config: IPositronLanguageModelConfig,
	source: IPositronLanguageModelSource,
	onChange: (config: IPositronLanguageModelConfig) => void,
	onSignIn: () => void,
	onCancel: () => void,
}

type IProvider = IPositronLanguageModelSource['provider'];

const positEulaLabel = localize('positron.languageModelConfig.positEula', 'Posit EULA');
const completionsOnlyEmphasizedText = localize('positron.languageModelConfig.completionsOnly', 'code completions only');
const providerTermsOfServiceLabel = localize('positron.languageModelConfig.termsOfService', 'Terms of Service');
const providerPrivacyPolicyLabel = localize('positron.languageModelConfig.privacyPolicy', 'Privacy Policy');

const apiKeyInputLabel = localize('positron.languageModelConfig.apiKeyInputLabel', 'API Key');
const baseUrLInputLabel = localize('positron.languageModelConfig.baseUrlInputLabel', 'Base URL');
const modelNameInputLabel = localize('positron.languageModelConfig.modelNameInputLabel', 'Model');
const signInButtonLabel = localize('positron.languageModelConfig.signIn', 'Sign in');
const signOutButtonLabel = localize('positron.languageModelConfig.signOut', 'Sign out');

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

/**
 * A component for configuring a language model provider.
 * Currently, this displays the appropriate authentication method UI based on the provider's authentication method,
 * and allows the user to sign in with OAuth or an API key.
 * It also displays terms of service and usage disclaimers for the provider.
 * In the future, this component may be extended to support additional configuration options for language models.
 */
export const LanguageModelConfigComponent = (props: LanguageModelConfigComponentProps) => {
	const { authMethod, authStatus, config, source } = props;
	const { apiKey, baseUrl, model } = config;
	const hasEnvApiKey = !!source.defaults.apiKeyEnvVar && source.defaults.apiKeyEnvVar.signedIn;
	const showApiKeyInput = authMethod === AuthMethod.API_KEY && authStatus !== AuthStatus.SIGNED_IN && !hasEnvApiKey;
	const showCancelButton = authMethod === AuthMethod.OAUTH && authStatus === AuthStatus.SIGNING_IN && !hasEnvApiKey;
	const needBaseUrl = source.supportedOptions.includes('baseUrl') && authMethod === AuthMethod.API_KEY && authStatus !== AuthStatus.SIGNED_IN;

	// This currently only updates the API key for the provider, but in the future it may be extended to support
	// additional configuration options for language models.
	const onApiKeyChange = (newApiKey: string) => {
		props.onChange({ ...props.config, apiKey: newApiKey });
	};
	const onBaseUrlChange = (newBaseUrl: string) => {
		props.onChange({ ...props.config, baseUrl: newBaseUrl });
	};
	const onModelNameChange = (newModel: string) => {
		props.onChange({ ...props.config, model: newModel });
	};

	return <>
		{needBaseUrl && <div className='language-model-container input'>
			<BaseUrl baseUrl={baseUrl} onChange={onBaseUrlChange} />
			<ModelName modelName={model} onChange={onModelNameChange} />
		</div>}
		{!hasEnvApiKey && <div className='language-model-container input'>
			{showApiKeyInput && <ApiKey apiKey={apiKey} onChange={onApiKeyChange} />}
			<SignInButton authMethod={authMethod} authStatus={authStatus} onSignIn={props.onSignIn} />
			{showCancelButton &&
				<Button className='language-model button cancel' onPressed={() => props.onCancel()}>
					{localize('positron.languageModelConfig.cancel', "Cancel")}
				</Button>
			}
		</div>}
		<ExternalAPIKey envKeyName={source.defaults.apiKeyEnvVar} provider={source.provider.id} />
		<ProviderNotice provider={source.provider} />
	</>;
}

// Language config parts
const ApiKey = (props: { apiKey?: string, onChange: (newApiKey: string) => void }) => {
	return (<>
		<div className='language-model-authentication-container' id='api-key-input'>
			<LabeledTextInput
				label={apiKeyInputLabel}
				type='password'
				value={props.apiKey ?? ''}
				onChange={e => { props.onChange(e.currentTarget.value) }} />
		</div>
	</>)
}

const BaseUrl = (props: { baseUrl?: string, onChange: (newBaseUrl: string) => void }) => {
	return (<>
		<div className='language-model-authentication-container' id='api-key-input'>
			<LabeledTextInput
				label={baseUrLInputLabel}
				type='text'
				value={props.baseUrl ?? ''}
				onChange={e => { props.onChange(e.currentTarget.value) }} />
		</div>
	</>)
}

const ModelName = (props: { modelName?: string, onChange: (newModelName: string) => void }) => {
	const displayValue = props.modelName === 'default' ? '' : (props.modelName ?? '');
	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.currentTarget.value;
        // If the value is empty, return "default", otherwise return the actual value
        props.onChange(value === '' ? 'default' : value);
    };
	return (<>
		<div className='language-model-authentication-container' id='api-key-input'>
			<LabeledTextInput
				label={modelNameInputLabel}
				type='text'
				value={displayValue}
				onChange={handleChange} />
		</div>
	</>)
}

const SignInButton = (props: { authMethod: AuthMethod, authStatus: AuthStatus, onSignIn: () => void }) => {
	// Use the default button style when the auth method is 'apiKey' and authentication is in progress (user
	// is entering an API key). This allows the Enter key to submit the API key input field.
	const useDefaultButtonStyle = props.authMethod === AuthMethod.API_KEY && props.authStatus === AuthStatus.SIGN_IN_PENDING;
	return <Button
		className={`language-model button sign-in ${useDefaultButtonStyle ? 'default' : ''}`}
		disabled={props.authStatus === AuthStatus.SIGNING_IN}
		onPressed={props.onSignIn}
	>
		{props.authStatus === AuthStatus.SIGNED_IN ? signOutButtonLabel : signInButtonLabel}
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

const ExternalAPIKey = (props: { provider: string, envKeyName?: { key: string; signedIn: boolean } }) => {

	return (
		props.envKeyName ?
			<div className='language-model-external-api-key'>
				{
					props.envKeyName && props.envKeyName.signedIn ?
						<p>{localize('positron.languageModelConfig.externalApiInUse', "The {0} environment variable is currently in use", props.envKeyName?.key)}</p>
						:
						<p>{localize('positron.languageModelConfig.externalApiSetup', "You can also assign the {0} environment variable and restart Positron", props.envKeyName.key)}</p>
				}
			</div> : null
	);
}
