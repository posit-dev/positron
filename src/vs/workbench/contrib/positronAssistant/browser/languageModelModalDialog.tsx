/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './languageModelModalDialog.css';

// React.
import React, { useEffect } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { VerticalStack } from '../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import { DropDownListBoxItem } from '../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { IPositronAssistantService, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { localize } from '../../../../nls.js';
import { ProgressBar } from '../../../../base/browser/ui/positronComponents/progressBar.js';
import { LanguageModelButton } from './components/languageModelButton.js';
import { OKModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { LanguageModelConfigComponent } from './components/languageModelConfigComponent.js';
import { RadioButtonItem } from '../../../browser/positronComponents/positronModalDialog/components/radioButton.js';
import { RadioGroup } from '../../../browser/positronComponents/positronModalDialog/components/radioGroup.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { AuthMethod } from './types.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';

export const showLanguageModelModalDialog = (
	keybindingService: IKeybindingService,
	layoutService: ILayoutService,
	configurationService: IConfigurationService,
	positronAssistantService: IPositronAssistantService,
	positronModalDialogsService: IPositronModalDialogsService,
	sources: IPositronLanguageModelSource[],
	// maybe pass in stored configs here in addition to sources which is for UI state
	onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>,
	onClose: () => void,
) => {
	const renderer = new PositronModalReactRenderer({
		keybindingService: keybindingService,
		layoutService: layoutService,
		container: layoutService.activeContainer
	});

	renderer.render(
		<div className='language-model-modal-dialog'>
			<LanguageModelConfiguration
				configurationService={configurationService}
				keybindingService={keybindingService}
				layoutService={layoutService}
				positronAssistantService={positronAssistantService}
				positronModalDialogsService={positronModalDialogsService}
				renderer={renderer}
				sources={sources}
				onAction={onAction}
				onClose={onClose}
			/>
		</div>
	);
};

interface LanguageModelConfigurationProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	positronAssistantService: IPositronAssistantService;
	positronModalDialogsService: IPositronModalDialogsService;
	sources: IPositronLanguageModelSource[]; // full array of static sources we've defined
	configurationService: IConfigurationService;
	renderer: PositronModalReactRenderer;
	onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>;
	onClose: () => void;
}

export interface LanguageModelUIConfiguration extends IPositronLanguageModelConfig {
	signedIn?: boolean;
	isTest?: boolean;
	apiKey?: string;
}

// Other Models --> just "Models"?

const LanguageModelConfiguration = (props: React.PropsWithChildren<LanguageModelConfigurationProps>) => {
	const enabledProviders = props.sources.map(source => source.provider.id);
	const hasAnthropic = enabledProviders.includes('anthropic');
	const hasMistral = enabledProviders.includes('mistral');

	// defaultSource is used to pre-select the provider in the modal dialog.
	// we can probably just select the first one by default, which happens to be Anthropic?
	// this was used for the old modal dialog, but we don't need this anymore
	const defaultSource = props.sources.find(source => {
		// If Anthropic is available, prefer it for chat models
		if (hasAnthropic) {
			return source.provider.id === 'anthropic';
		}
		// If Mistral is available, prefer it for completion models ?????
		// is this working?
		if (hasMistral) {
			return source.provider.id === 'mistral';
		}
		// In all other cases, prefer the first available provider
		return true;
	})!;

	// this is the source of the provider, for the awareness of the extension
	const [source, setSource] = React.useState<IPositronLanguageModelSource>(defaultSource);
	// this contains some info for the UI state, like if we're signed in, api key (goes in safe storage), other info goes in regular storage
	const [providerConfig, setProviderConfig] = React.useState<LanguageModelUIConfiguration>({ ...defaultSource.defaults, name: defaultSource.provider.displayName, provider: defaultSource.provider.id, type: defaultSource.type });

	// this is also truly part of the UI state, it is the api key entered in the text box
	const [apiKey, setApiKey] = React.useState<string>();

	const [baseUrl, setBaseUrl] = React.useState<string | undefined>(defaultSource.defaults.baseUrl);
	const [resourceName, setResourceName] = React.useState<string | undefined>(defaultSource.defaults.resourceName);
	const [project, setProject] = React.useState<string | undefined>(defaultSource.defaults.project);
	const [location, setLocation] = React.useState<string | undefined>(defaultSource.defaults.location);
	const [toolCalls, setToolCalls] = React.useState<boolean | undefined>(defaultSource.defaults.toolCalls);
	const [numCtx, setNumCtx] = React.useState<number | undefined>(defaultSource.defaults.numCtx);
	const [model, setModel] = React.useState<string>(defaultSource.defaults.model);
	const [name, setName] = React.useState<string>(defaultSource.defaults.name);

	// these are truly part of the UI state and not part of the provider config
	const [authMethod, setAuthMethod] = React.useState<AuthMethod>(defaultSource.defaults.oauth ? AuthMethod.OAUTH : AuthMethod.API_KEY);

	// these are purely UI state, not part of the provider config
	const [showProgress, setShowProgress] = React.useState(false);
	const [errorMessage, setError] = React.useState<string>();

	// this is maybe already covered above in the useStates?
	// useEffect(() => {
	// 	setSource(defaultSource);
	// 	setAuthMethod(defaultSource.defaults.oauth ? AuthMethod.OAUTH : AuthMethod.API_KEY)
	// }, [defaultSource]);

	useEffect(() => {
		const disposables: IDisposable[] = [];

		// if we pass in stored model configs, this would be modifed to update that stored config
		disposables.push(props.positronAssistantService.onChangeLanguageModelConfig((newConfig) => {
			// find newSource in props.sources and update it
			const index = props.sources.findIndex(source => source.provider.id === newConfig.provider.id);

			// NOTE: the goal of this is to record in the source that we're now signed in, so that the UI can reflect that
			// this is because we can't learn the result of the sign-in action directly, so we need to listen to this
			// event and update our local sources state accordingly
			// NOTE: we don't get the api key back from the extension
			const updatedSource = { ...source, supportedOptions: source.supportedOptions, signedIn: newConfig.signedIn };
			if (index >= 0) {
				props.sources[index] = updatedSource;
			}

			// if newSource matches source, update source
			if (source.provider.id === newConfig.provider.id) {
				setSource(updatedSource);
			}

		}));

		return () => { disposables.forEach(d => d.dispose()); }
	}, [props.positronAssistantService, props.sources, source]);

	// CURRENTLY
	// sources = state of the UI, contains signedIn info
	// providerConfig = bundle of info that is sent at sign in / sign out and returned by the extension once that action completes; it is also what is persisted in storage

	// PROPOSED
	// sources = initial info to populate the UI, such as which providers, the auth methods that are available, etc.
	// configsForSources = getStoredConfigs(), has values for
	// providerConfig = current state for the selected provider, which is also what's sent to the extension; still what is sent to storage

	useEffect(() => {
		setModel(source.defaults.model);
		setName(source.defaults.name);
		setApiKey(source.defaults.apiKey);
		setBaseUrl(source.defaults.baseUrl);
		setResourceName(source.defaults.resourceName);
		setProject(source.defaults.project);
		setLocation(source.defaults.location);
		setToolCalls(source.defaults.toolCalls);
		setNumCtx(source.defaults.numCtx);
	}, [source]);

	useEffect(() => {
		const newAuthMethod = source.defaults.oauth ? AuthMethod.OAUTH : AuthMethod.API_KEY;
		setAuthMethod(newAuthMethod);
	}, [source.defaults.oauth]);

	const authMethodRadioButtons: RadioButtonItem[] = [
		new RadioButtonItem({
			identifier: AuthMethod.OAUTH,
			title: localize('positron.languageModelProviderModalDialog.oauth', "OAuth"),
			disabled: !source.supportedOptions.includes(AuthMethod.OAUTH),
		}),
		new RadioButtonItem({
			identifier: AuthMethod.API_KEY,
			title: localize('positron.languageModelProviderModalDialog.apiKey', "API Key"),
			disabled: !source.supportedOptions.includes(AuthMethod.API_KEY),
		}),
	];

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
		})
		.map(source => new DropDownListBoxItem({
			identifier: source.provider.id,
			title: source.provider.displayName,
			value: source,
		}))

	const onAccept = async () => {
		if (await shouldCloseModal()) {
			await onCancelPending();
			props.onClose();
			props.renderer.dispose();
		}
	}

	const onSignIn = async () => {
		if (!source) {
			return;
		}
		setShowProgress(true);
		setError(undefined);
		if (providerConfig) {
			if (authMethod === AuthMethod.API_KEY) {
				await props.onAction(
					providerConfig,
					source.signedIn ? 'delete' : 'save')
					.catch((e) => {
						setError(e.message);
					}).finally(() => {
						setShowProgress(false);
					});
			} else {
				await props.onAction(
					providerConfig,
					source.signedIn ? 'oauth-signout' : 'oauth-signin')
					.catch((e) => {
						setError(e.message);
					}).finally(() => {
						setShowProgress(false);
					});
			}
		} else {
			setShowProgress(false);
			setError(localize('positron.languageModelProviderModalDialog.incompleteConfig', 'The configuration is incomplete.'));
		}

		if (providerConfig.completions) {
			setShowProgress(true);
			// Assume a completion source exists with the same provider ID and compatible auth details
			const completionSource = props.sources.find((source) => source.provider.id === providerConfig.provider && source.type === 'completion')!;
			const completionConfig = {
				provider: providerConfig.provider,
				type: PositronLanguageModelType.Completion,
				...completionSource.defaults,
				apiKey: providerConfig.apiKey,
				oauth: providerConfig.oauth,
			}
			await props.onAction(
				completionConfig,
				source.signedIn ? 'delete' : 'save')
				.catch((e) => {
					setError(e.message);
				}).finally(() => {
					setShowProgress(false);
				});
		}
	}

	// find positron.ai.showLanguageModelConfig in extensions/positron-assistant/src/config.ts
	// for the onAction actions

	// Cancel pending actions with providers
	// NOTE: this is currently only applicable to Copilot OAuth
	const onCancelPending = async () => {
		props.onAction({
			type: providerConfig.type,
			provider: source.provider.id,
			model: model,
			name: name,
			apiKey: apiKey,
			baseUrl: baseUrl,
			resourceName: resourceName,
			project: project,
			location: location,
			toolCalls: toolCalls,
			numCtx: numCtx,
		}, 'cancel')
			.catch((e) => {
				setError(e.message);
			}).finally(() => {
				setShowProgress(false);
			});
	}

	const shouldCloseModal = async () => {
		if (source.signedIn) {
			return true;
		}

		if (authMethod === AuthMethod.OAUTH && showProgress) {
			return await props.positronModalDialogsService.showSimpleModalDialogPrompt(
				localize('positron.languageModelProviderModalDialog.oauthInProgressTitle', "{0} Authentication in Progress", source.provider.displayName),
				localize('positron.languageModelProviderModalDialog.oauthInProgressMessage', "The sign in flow is in progress. If you close this dialog, your sign in may not complete. Are you sure you want to close and abandon signing in?"),
				localize('positron.languageModelProviderModalDialog.ok', "Yes"),
				localize('positron.languageModelProviderModalDialog.cancel', "No"),
			)
		}
		if (authMethod === AuthMethod.API_KEY && !!providerConfig.apiKey && providerConfig.apiKey.length > 0) {
			return await props.positronModalDialogsService.showSimpleModalDialogPrompt(
				localize('positron.languageModelProviderModalDialog.apiKeySignInIncompleteTitle', "{0} Authentication Incomplete", source.provider.displayName),
				localize('positron.languageModelProviderModalDialog.apiKeySignInIncompleteMessage', "You have entered an API key, but have not signed in. If you close this dialog, your API key will not be saved. Are you sure you want to close and abandon signing in?"),
				localize('positron.languageModelProviderModalDialog.ok', "Yes"),
				localize('positron.languageModelProviderModalDialog.cancel', "No"),
			)
		}

		return true;
	}

	return <OKModalDialog
		height={400}
		okButtonTitle={(() => localize('positron.languageModelModalDialog.close', "Close"))()}
		renderer={props.renderer}
		title={(() => localize('positron.languageModelModalDialog.title', "Configure Language Model Providers"))()}
		width={600}
		onAccept={onAccept}
		// onCancel is called when the Escape key is pressed, which in this dialog has the same effect as clicking the OK button
		// so we just call onAccept to close the dialog
		onCancel={onAccept}
	>
		<VerticalStack>
			<label className='language-model-section'>
				{(() => localize('positron.languageModelProviderModalDialog.provider', "Provider"))()}
			</label>
			<div className='language-model button-container'>
				{
					providers.map(provider => {
						return <LanguageModelButton
							key={provider.options.identifier}
							disabled={showProgress}
							displayName={provider.options.title ?? provider.options.identifier}
							identifier={provider.options.identifier}
							selected={provider.options.identifier === source.provider.id}
							onClick={() => {
								setSource(provider.options.value);
								setProviderConfig({ ...provider.options.value, ...provider.options.value.defaults, provider: provider.options.identifier, type: provider.options.value.type });
								setError(undefined);
							}}
						/>
					})
				}
			</div>
			<label className='language-model-section'>
				{(() => localize('positron.languageModelProviderModalDialog.authentication', "Authentication"))()}
			</label>
			<div className='language-model-authentication-method-container'>
				<RadioGroup
					entries={authMethodRadioButtons}
					initialSelectionId={authMethod}
					name='authMethod'
					onSelectionChanged={(authMethod) => {
						setAuthMethod(authMethod as AuthMethod);
					}}
				/>
			</div>
			<LanguageModelConfigComponent
				authMethod={authMethod}
				provider={providerConfig}
				signingIn={showProgress}
				source={source}
				onCancel={onCancelPending}
				onChange={(config) => {
					setProviderConfig(config);
				}}
				onSignIn={onSignIn}
			/>
			{showProgress &&
				<ProgressBar />
			}
			{errorMessage &&
				<div className='language-model-error error error-msg'>{errorMessage}</div>
			}
		</VerticalStack>
	</OKModalDialog>;
}
