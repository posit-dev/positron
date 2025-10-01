/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './languageModelModalDialog.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { VerticalStack } from '../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, PositronLanguageModelType } from '../common/interfaces/positronAssistantService.js';
import { localize } from '../../../../nls.js';
import { ProgressBar } from '../../../../base/browser/ui/positronComponents/progressBar.js';
import { LanguageModelButton } from './components/languageModelButton.js';
import { OKModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { LanguageModelConfigComponent } from './components/languageModelConfigComponent.js';
import { RadioButtonItem } from '../../../browser/positronComponents/positronModalDialog/components/radioButton.js';
import { RadioGroup } from '../../../browser/positronComponents/positronModalDialog/components/radioGroup.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { AuthMethod, AuthStatus } from './types.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';

export const showLanguageModelModalDialog = (
	sources: IPositronLanguageModelSource[],
	onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>,
	onClose: () => void,
) => {
	const renderer = new PositronModalReactRenderer();

	renderer.render(
		<div className='language-model-modal-dialog'>
			<LanguageModelConfiguration
				renderer={renderer}
				sources={sources}
				onAction={onAction}
				onClose={onClose}
			/>
		</div>
	);
};

const providerSourceToConfig = (source: IPositronLanguageModelSource): IPositronLanguageModelConfig => {
	return {
		...source.defaults,
		name: source.provider.displayName,
		provider: source.provider.id,
		type: source.type
	};
}

interface LanguageModelConfigurationProps {
	sources: IPositronLanguageModelSource[];
	renderer: PositronModalReactRenderer;
	// To find available actions, search for positron.ai.showLanguageModelConfig in extensions/positron-assistant/src/config.ts
	onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>;
	onClose: () => void;
}

const LanguageModelConfiguration = (props: React.PropsWithChildren<LanguageModelConfigurationProps>) => {
	// Construct the list of providers from the sources, which are defined in the extension. See extensions/positron-assistant/src/models.ts
	const allProviders = props.sources;
	const providers = props.sources
		.filter(source => source.type === 'chat' || (source.type === 'completion' && source.provider.id === 'copilot'))
		.sort((a, b) => {
			if (a.provider.id === 'echo' || a.provider.id === 'error') {
				return 1;
			}
			if (b.provider.id === 'echo' || b.provider.id === 'error') {
				return -1;
			}
			return a.provider.displayName.localeCompare(b.provider.displayName);
		});

	// Default to the first provider in the list.
	const defaultProvider = providers[0];

	// The currently selected language model provider. The UI preselects this initial provider.
	const [selectedProvider, setSelectedProvider] = useState<IPositronLanguageModelSource>(defaultProvider);

	// Config for the provider, which is what is sent to the extension when signing in or out of a provider.
	const [providerConfig, setProviderConfig] = useState<IPositronLanguageModelConfig>(() => providerSourceToConfig(defaultProvider));

	// UI State
	const [showProgress, setShowProgress] = useState(false);
	const [progressValue, setProgressValue] = useState(0);
	const [errorMessage, setErrorMessage] = useState<string>();

	// List of provider sources, which is updated when the service emits a change to a language model config.
	// Each provider source contains the info needed to populate the modal UI with provider details, such as
	// the provider ID, auth methods and whether the user is signed in or not with the provider.
	const [providerSources, setProviderSources] = useState<IPositronLanguageModelSource[]>(providers);

	// Update the provider sources when the service emits a change to the language model config.
	// This occurs when a user signs in or out of a provider.
	useEffect(() => {
		const disposables: IDisposable[] = [];
		disposables.push(props.renderer.services.positronAssistantService.onChangeLanguageModelConfig((newSource) => {
			// Note: newSource is technically an IPositronLanguageModelSource, but it may not be in the same format and may be missing
			// some properties from the original source. See expandConfigToSource in extensions/positron-assistant/src/config.ts
			// for how the source is expanded from the stored model config.
			setProviderSources(prevSources => {
				const index = prevSources.findIndex(source => source.provider.id === newSource.provider.id);
				const updatedSources = [...prevSources];
				if (index !== -1) {
					updatedSources[index] = {
						...prevSources[index],
						// We only update the signedIn status, as the other properties should not change, and the
						// shape of the newSource differs from the original source.
						signedIn: newSource.signedIn,
					};
				}
				return updatedSources;
			});
		}));
		return () => { disposables.forEach(d => d.dispose()); }
	}, [props.renderer.services.positronAssistantService]);

	// Keep selectedProvider in sync with providerSources
	useEffect(() => {
		const updatedSource = providerSources.find(source => source.provider.id === selectedProvider.provider.id);
		if (updatedSource) {
			setSelectedProvider(updatedSource);
		}
	}, [providerSources, selectedProvider.provider.id]);

	// Progress tracking based on timeout setting
	useEffect(() => {
		if (!showProgress) {
			setProgressValue(0);
			return;
		}

		// Get the timeout value from configuration (in seconds, convert to milliseconds)
		const timeoutSeconds = props.renderer.services.configurationService.getValue<number>('positron.assistant.providerTimeout');
		const timeoutMs = timeoutSeconds * 1000;

		const startTime = Date.now();
		const updateInterval = 100; // Update every 100ms for smooth progress
		const targetWindow = DOM.getActiveWindow();

		const interval = targetWindow.setInterval(() => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min((elapsed / timeoutMs) * 100, 100);
			setProgressValue(progress);

			if (progress >= 100 || !showProgress) {
				targetWindow.clearInterval(interval);
			}
		}, updateInterval);

		return () => targetWindow.clearInterval(interval);
	}, [showProgress, props.renderer.services.configurationService]);

	/** Check if the current provider is one of the signed in providers */
	const isSignedIn = () => {
		return providerSources.some(source => source.provider.id === selectedProvider.provider.id && source.signedIn);
	}

	/** Check if OAuth is in progress */
	const isOauthInProgress = () => {
		return showProgress && getAuthMethod() === AuthMethod.OAUTH;
	}

	/** Check if API key auth is in progress */
	const isApiKeyAuthInProgress = () => {
		return getAuthMethod() === AuthMethod.API_KEY && !!providerConfig.apiKey && providerConfig.apiKey.length > 0;
	}

	/** Derive the auth status from the selected provider or progress state */
	const getAuthStatus = () => {
		if (selectedProvider.signedIn) {
			return AuthStatus.SIGNED_IN;
		}
		if (showProgress) {
			return AuthStatus.SIGNING_IN;
		}
		if (isApiKeyAuthInProgress()) {
			return AuthStatus.SIGN_IN_PENDING;
		}
		return AuthStatus.SIGNED_OUT;
	}

	/** Derive the auth method from the selected provider */
	const getAuthMethod = () => {
		// We don't currently support more than one auth method per provider.
		if (selectedProvider.supportedOptions.includes(AuthMethod.OAUTH)) {
			return AuthMethod.OAUTH;
		} else if (selectedProvider.supportedOptions.includes(AuthMethod.API_KEY)) {
			return AuthMethod.API_KEY;
		}
		return AuthMethod.NONE;
	}

	/** When the user clicks a different provider in the modal */
	const onChangeProvider = (provider: IPositronLanguageModelSource) => {
		setSelectedProvider(provider);
		setProviderConfig(providerSourceToConfig(provider));
		setShowProgress(false);
		setErrorMessage(undefined);
	}

	/** When the user clicks the Close button or presses Esc */
	const onClose = async () => {
		if (await shouldCloseModal()) {
			await onCancel();
			props.onClose();
			props.renderer.dispose();
		}
	}

	/** Checks if the modal should be closed. Asks user to accept/reject modal close if auth is currently in progress. */
	const shouldCloseModal = async () => {
		if (isSignedIn()) {
			return true;
		}

		if (isOauthInProgress()) {
			return await props.renderer.services.positronModalDialogsService.showSimpleModalDialogPrompt(
				localize('positron.languageModelProviderModalDialog.oauthInProgressTitle', "{0} Authentication in Progress", selectedProvider.provider.displayName),
				localize('positron.languageModelProviderModalDialog.oauthInProgressMessage', "The sign in flow is in progress. If you close this dialog, your sign in may not complete. Are you sure you want to close and abandon signing in?"),
				localize('positron.languageModelProviderModalDialog.ok', "Yes"),
				localize('positron.languageModelProviderModalDialog.cancel', "No"),
			)
		}
		if (isApiKeyAuthInProgress()) {
			return await props.renderer.services.positronModalDialogsService.showSimpleModalDialogPrompt(
				localize('positron.languageModelProviderModalDialog.apiKeySignInIncompleteTitle', "{0} Authentication Incomplete", selectedProvider.provider.displayName),
				localize('positron.languageModelProviderModalDialog.apiKeySignInIncompleteMessage', "You have entered an API key, but have not signed in. If you close this dialog, your API key will not be saved. Are you sure you want to close and abandon signing in?"),
				localize('positron.languageModelProviderModalDialog.ok', "Yes"),
				localize('positron.languageModelProviderModalDialog.cancel', "No"),
			)
		}

		return true;
	}

	/** When the user clicks the Sign In button */
	const onSignIn = async () => {
		if (!selectedProvider) {
			return;
		}
		setShowProgress(true);
		setErrorMessage(undefined);

		try {
			if (!providerConfig) {
				setErrorMessage(localize('positron.languageModelProviderModalDialog.incompleteConfig', 'The configuration is incomplete.'));
				return;
			}

			// Handle the main chat/completion model configuration
			switch (getAuthMethod()) {
				case AuthMethod.NONE:
				// Use the same actions as API_KEY
				case AuthMethod.API_KEY:
					await props.onAction(providerConfig, isSignedIn() ? 'delete' : 'save');
					break;
				case AuthMethod.OAUTH:
					await props.onAction(providerConfig, isSignedIn() ? 'oauth-signout' : 'oauth-signin');
					break;
				default:
					setErrorMessage(localize('positron.languageModelProviderModalDialog.unsupportedAuthMethod', 'Unsupported authentication method.'));
					return;
			}

			// Handle completion model if needed
			if (providerConfig.completions) {
				// Assume a completion source exists with the same provider ID and compatible auth details
				const completionSource = allProviders.find((source) => source.provider.id === providerConfig.provider && source.type === 'completion')!;
				const completionConfig = {
					provider: providerConfig.provider,
					type: PositronLanguageModelType.Completion,
					...completionSource.defaults,
					apiKey: providerConfig.apiKey,
					oauth: providerConfig.oauth,
				}
				await props.onAction(
					completionConfig,
					selectedProvider.signedIn ? 'delete' : 'save');
			}
		} catch (e) {
			setErrorMessage(e instanceof Error ? e.message : String(e));
		} finally {
			setShowProgress(false);
		}
	}

	/** Signal to the current provider that the user has requested cancellation */
	const onCancel = async () => {
		// NOTE: this action is currently only applicable to Copilot OAuth.
		// See positron.ai.showLanguageModelConfig in extensions/positron-assistant/src/config.ts
		await props.onAction(providerConfig, 'cancel')
			.catch((e) => {
				setErrorMessage(e.message);
			}).finally(() => {
				setShowProgress(false);
			});
	}

	/** Radio buttons for the authentication method selection */
	const authMethodRadioButtons: RadioButtonItem[] = [
		new RadioButtonItem({
			identifier: AuthMethod.OAUTH,
			title: localize('positron.languageModelProviderModalDialog.oauth', "OAuth"),
			disabled: !selectedProvider.supportedOptions.includes(AuthMethod.OAUTH),
		}),
		new RadioButtonItem({
			identifier: AuthMethod.API_KEY,
			title: localize('positron.languageModelProviderModalDialog.apiKey', "API Key"),
			disabled: !selectedProvider.supportedOptions.includes(AuthMethod.API_KEY),
		}),
	];

	return <OKModalDialog
		height={450}
		okButtonTitle={(() => localize('positron.languageModelModalDialog.close', "Close"))()}
		renderer={props.renderer}
		title={(() => localize('positron.languageModelModalDialog.title', "Configure Language Model Providers"))()}
		width={600}
		onAccept={onClose}
		onCancel={onClose}
	>
		<VerticalStack>
			<label className='language-model-section'>
				{(() => localize('positron.languageModelProviderModalDialog.provider', "Provider"))()}
			</label>
			<div className='language-model button-container'>
				{
					providerSources.map(source => {
						return <LanguageModelButton
							key={source.provider.id}
							disabled={showProgress}
							displayName={source.provider.displayName}
							identifier={source.provider.id}
							selected={source.provider.id === selectedProvider.provider.id}
							onClick={() => onChangeProvider(source)}
						/>
					})
				}
			</div>
			<label className='language-model-section'>
				{(() => localize('positron.languageModelProviderModalDialog.authentication', "Authentication"))()}
			</label>
			{
				getAuthMethod() !== AuthMethod.NONE &&
				<div className='language-model-authentication-method-container'>
					<RadioGroup
						entries={authMethodRadioButtons}
						initialSelectionId={getAuthMethod()}
						name='authMethod'
						onSelectionChanged={(authMethod) => {
							// TODO: it's not currently possible to change the auth method, as each provider only
							// supports one auth method at a time. This is a placeholder for future support.
						}}
					/>
				</div>
			}
			<LanguageModelConfigComponent
				authMethod={getAuthMethod()}
				authStatus={getAuthStatus()}
				config={providerConfig}
				source={selectedProvider}
				onCancel={onCancel}
				onChange={(config) => {
					setProviderConfig(config);
				}}
				onSignIn={onSignIn}
			/>
			{showProgress &&
				<ProgressBar value={progressValue} />
			}
			{errorMessage &&
				<div className='language-model-error error error-msg'>{errorMessage}</div>
			}
		</VerticalStack>
	</OKModalDialog>;
}
