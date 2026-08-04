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
import { getProviderGettingStartedText, getProviderTermsOfServiceText, getProviderUsageDisclaimerText } from '../providerLegalText.js'

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

const apiKeyInputLabel = localize('positron.languageModelConfig.apiKeyInputLabel', 'API Key');
const signInButtonLabel = localize('positron.languageModelConfig.signIn', 'Sign in');
const signOutButtonLabel = localize('positron.languageModelConfig.signOut', 'Sign out');
const copilotSignoutGuidanceLabel = localize(
	'positron.languageModelConfig.copilotSignoutGuidance',
	"To sign out of GitHub, use the [Accounts: Manage Accounts]({0}) command. Note that this will sign you out of GitHub for all extensions in Positron.",
	'command:workbench.action.manageAccounts'
);

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
	const showBaseUrl = (authMethod === AuthMethod.API_KEY || authMethod === AuthMethod.NONE) && source.supportedOptions?.includes('baseUrl') && !hasAutoconfigure;

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

