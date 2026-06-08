/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react'
import { IPositronLanguageModelAutoconfigure, LanguageModelAutoconfigureType, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js'
import { localize } from '../../../../../nls.js'
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js'
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js'
import { AuthMethod, AuthStatus } from '../types.js'
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js'

interface LanguageModelConfigComponentProps {
	authMethod: AuthMethod,
	authStatus: AuthStatus,
	config: IPositronLanguageModelConfig,
	source: IPositronLanguageModelSource,
	onChange: (config: IPositronLanguageModelConfig) => void,
	onSignIn: (apiKeyFromInput?: string) => void,
	onCancel: () => void,
	closeDialog: () => void,
}

type IProvider = IPositronLanguageModelSource['provider'];

const positEulaLabel = localize('positron.languageModelConfig.positEula', 'Posit EULA');
const providerTermsOfServiceLabel = localize('positron.languageModelConfig.termsOfService', 'Terms of Service');
const providerPrivacyPolicyLabel = localize('positron.languageModelConfig.privacyPolicy', 'Privacy Policy');

/**
 * Builds a markdown link fragment `[label](href)` for `EmbeddedLink`, or plain
 * label text when there's no URL (so the label still renders, just not linked).
 */
function linkFragment(label: string, href: string | undefined): string {
	return href ? `[${label}](${href})` : label;
}

const apiKeyInputLabel = localize('positron.languageModelConfig.apiKeyInputLabel', 'API Key');
const signInButtonLabel = localize('positron.languageModelConfig.signIn', 'Sign in');
const signOutButtonLabel = localize('positron.languageModelConfig.signOut', 'Sign out');
const copilotSignoutGuidanceLabel = localize(
	'positron.languageModelConfig.copilotSignoutGuidance',
	"To sign out of GitHub, use the [Accounts: Manage Accounts]({0}) command. Note that this will sign you out of GitHub for all extensions in Positron.",
	'command:workbench.action.manageAccounts'
);

function getProviderTermsOfServiceText(provider: IProvider) {
	const tos = linkFragment(providerTermsOfServiceLabel, getProviderTermsOfServiceLink(provider.id));
	const privacy = linkFragment(providerPrivacyPolicyLabel, getProviderPrivacyPolicyLink(provider.id));
	const eula = linkFragment(positEulaLabel, 'https://posit.co/about/eula/');
	if (provider.id === 'openai-compatible') {
		return localize(
			'positron.languageModelConfig.openAiCompatible.tos',
			'A custom provider is considered "Third Party Materials" as defined in the {0} and subject to its {1} and {2}.',
			eula, tos, privacy,
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
function getProviderGettingStartedText(provider: IProvider): string | undefined {
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

function getProviderUsageDisclaimerText(provider: IProvider) {
	if (provider.id === 'openai-compatible') {
		return localize(
			'positron.languageModelConfig.openAiCompatible.tos2',
			'Your use of the custom provider is optional and at your sole risk.',
		);
	}
	return localize(
		'positron.languageModelConfig.tos2',
		'Your use of {0} is optional and at your sole risk.',
		provider.displayName,
	);
}

function getProviderTermsOfServiceLink(providerId: string) {
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

function getProviderPrivacyPolicyLink(providerId: string) {
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

/**
 * A component for configuring a language model provider.
 * Currently, this displays the appropriate authentication method UI based on the provider's authentication method,
 * and allows the user to sign in with OAuth or an API key.
 * It also displays terms of service and usage disclaimers for the provider.
 * In the future, this component may be extended to support additional configuration options for language models.
 */
export const LanguageModelConfigComponent = (props: LanguageModelConfigComponentProps) => {
	const { authMethod, authStatus, config, source } = props;
	const { apiKey } = config;
	const apiKeyInputRef = React.useRef<HTMLInputElement | null>(null);

	// hasAutoconfigure should only be true if the provider was autoconfigured AND the user is currently signed in.
	// When the user signs out, we need to show the Sign In button even if autoconfigure.signedIn is still true.
	const hasAutoconfigure = !!source.defaults.autoconfigure && source.defaults.autoconfigure.signedIn && authStatus === AuthStatus.SIGNED_IN;
	const showApiKeyInput = authMethod === AuthMethod.API_KEY && authStatus !== AuthStatus.SIGNED_IN && !hasAutoconfigure;
	const showCancelButton = authMethod === AuthMethod.OAUTH && authStatus === AuthStatus.SIGNING_IN && !hasAutoconfigure;
	const showBaseUrl = authMethod === AuthMethod.API_KEY && source.supportedOptions?.includes('baseUrl') && !hasAutoconfigure;

	// This currently only updates the API key for the provider, but in the future it may be extended to support
	// additional configuration options for language models.
	const onChange = (newApiKey: string) => {
		props.onChange({ ...props.config, apiKey: newApiKey });
	};

	return <>
		{!hasAutoconfigure && <div className='language-model-container input'>
			{showApiKeyInput && <ApiKey apiKey={apiKey} inputRef={apiKeyInputRef} onChange={onChange} />}
			<SignInButton authMethod={authMethod} authStatus={authStatus} onSignIn={() => props.onSignIn(apiKeyInputRef.current?.value)} />
			{showCancelButton &&
				<Button className='language-model button cancel' onPressed={() => props.onCancel()}>
					{localize('positron.languageModelConfig.cancel', "Cancel")}
				</Button>
			}
		</div>}
		{source.provider.id === 'copilot-auth' && authStatus === AuthStatus.SIGNED_IN && <CopilotSignoutGuidance closeDialog={props.closeDialog} />}
		{showBaseUrl && <BaseUrl baseUrl={config.baseUrl} provider={props.source.provider} signedIn={authStatus === AuthStatus.SIGNED_IN} onChange={newBaseUrl => props.onChange({ ...config, baseUrl: newBaseUrl })} />}
		<AutoconfiguredModel details={source.defaults.autoconfigure} displayName={source.provider.displayName} provider={source.provider.id} supportsBaseUrl={source.supportedOptions?.includes('baseUrl')} />
		<ProviderNotice provider={source.provider} />
	</>;
}

const DEPLOYMENT_URL_PATTERN = /\/openai\/deployments\//;
const SNOWFLAKE_PROVIDER_ID = 'snowflake-cortex';

const BaseUrl = (props: { baseUrl?: string; signedIn?: boolean; onChange: (newBaseUrl: string) => void; provider: IProvider }) => {
	// For Snowflake, baseUrl holds the bare account, not a URL: relabel as
	// "Account Identifier" and pass through. Don't make it a URL input (#13750).
	if (props.provider.id === SNOWFLAKE_PROVIDER_ID) {
		const accountLabel = localize('positron.languageModelConfig.snowflakeAccountInputLabel', 'Account Identifier');
		return (
			<div className='language-model-authentication-container' id='base-url-input'>
				{
					props.signedIn ?
						<p>{localize('positron.languageModelConfig.snowflakeAccountSignedIn', "Account Identifier: {0}", props.baseUrl)}</p>
						:
						<LabeledTextInput
							label={accountLabel}
							type='text'
							value={props.baseUrl ?? ''}
							onChange={e => { props.onChange(e.currentTarget.value); }} />
				}
			</div>
		);
	}

	const baseUrlLabel = props.provider.id === 'openai-compatible' ? localize('positron.languageModelConfig.baseUrlOpenAICompatibleInputLabel', 'Base URL (must be OpenAI compatible)') : localize('positron.languageModelConfig.baseUrlInputLabel', 'Base URL');
	const isDeploymentUrl = props.provider.id === 'ms-foundry' && props.baseUrl ? DEPLOYMENT_URL_PATTERN.test(props.baseUrl) : false;

	// When signed in with a deployment URL, show the normalized v1 URL
	let displayUrl = props.baseUrl;
	if (isDeploymentUrl && props.baseUrl) {
		const deploymentIndex = props.baseUrl.indexOf('/openai/deployments/');
		displayUrl = props.baseUrl.substring(0, deploymentIndex) + '/openai/v1';
	}

	return (<>
		<div className='language-model-authentication-container' id='base-url-input'>
			{
				props.signedIn ?
					<p>{localize('positron.languageModelConfig.baseUrlSignedIn', "Base URL: {0}", displayUrl)}</p>
					:
					<LabeledTextInput
						label={baseUrlLabel}
						type='text'
						value={props.baseUrl ?? ''}
						onChange={e => { props.onChange(e.currentTarget.value); }} />
			}
		</div>
		{isDeploymentUrl &&
			<div className='language-model-url-info'>
				<span className='codicon codicon-info' />
				<span>
					{props.signedIn
						? localize(
							'positron.languageModelConfig.deploymentUrlRewritten',
							"Deployment URL rewritten to use the OpenAI v1 endpoint."
						)
						: localize(
							'positron.languageModelConfig.deploymentUrlWillConvert',
							"Deployment URL will be rewritten to use the OpenAI v1 endpoint."
						)
					}
				</span>
			</div>
		}
	</>);
};

const ApiKey = (props: { apiKey?: string, inputRef: React.RefObject<HTMLInputElement | null>, onChange: (newApiKey: string) => void }) => {
	return (<>
		<div className='language-model-authentication-container' id='api-key-input'>
			<LabeledTextInput
				ref={props.inputRef}
				label={apiKeyInputLabel}
				type='password'
				value={props.apiKey ?? ''}
				onChange={e => { props.onChange(e.currentTarget.value) }} />
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
	const text = [
		getProviderGettingStartedText(props.provider),
		getProviderTermsOfServiceText(props.provider),
		getProviderUsageDisclaimerText(props.provider),
	].filter(Boolean).join('\n\n');

	return <div className='language-model-dialog-tos' data-testid='provider-notice' id='model-tos'>
		<EmbeddedLink>{text}</EmbeddedLink>
	</div>;
}

const AutoconfiguredModel = (props: { provider: string; displayName: string; details?: IPositronLanguageModelAutoconfigure; supportsBaseUrl?: boolean }) => {
	if (props.details?.type === LanguageModelAutoconfigureType.EnvVariable) {
		const baseUrlEnvVar = props.supportsBaseUrl
			? props.details.key.replace(/_API_KEY$/, '_BASE_URL')
			: undefined;
		return (<div className='language-model-authentication-container'>
			{
				props.details.signedIn && baseUrlEnvVar ?
					<p>{localize('positron.languageModelConfig.externalApiInUseWithBaseUrl', "✓ {0} authenticated automatically using environment variables {1} and {2}", props.displayName, props.details.key, baseUrlEnvVar)}</p>
					: props.details.signedIn ?
						<p>{localize('positron.languageModelConfig.externalApiInUse', "✓ {0} authenticated automatically using environment variable {1}", props.displayName, props.details.key)}</p>
						: baseUrlEnvVar ?
							<p>{localize('positron.languageModelConfig.externalApiSetupWithBaseUrl', "You can also assign the {0} and {1} environment variables and restart Positron.", props.details.key, baseUrlEnvVar)}</p>
							:
							<p>{localize('positron.languageModelConfig.externalApiSetup', "You can also assign the {0} environment variable and restart Positron.", props.details.key)}</p>
			}
		</div>);
	} else if (props.details?.type === LanguageModelAutoconfigureType.Custom && props.details.signedIn) {
		return (<div className='language-model-authentication-container'>
			{
				<p>{localize('positron.languageModelConfig.autoconfiguredModelInUse', "✓ {0} authenticated automatically using {1}", props.displayName, props.details.message)}</p>
			}
		</div>);
	} else {
		return null;
	}
}

const CopilotSignoutGuidance = (props: { closeDialog: () => void }) => {
	return <EmbeddedLink
		onLinkClick={(e) => props.closeDialog()}>
		{copilotSignoutGuidanceLabel}
	</EmbeddedLink>;
}

