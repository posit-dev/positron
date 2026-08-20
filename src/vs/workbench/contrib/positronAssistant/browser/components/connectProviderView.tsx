/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useEffect, useRef, useState } from 'react';

import { localize } from '../../../../../nls.js';
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';
import { IPositronCustomModel, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { AuthMethod, AuthStatus } from '../types.js';
import { availableAuthMethods, deriveAuthMethod, deriveAuthStatus, deriveConnectAction } from '../providerConnection.js';
import { getProviderGettingStartedText, getProviderTermsOfServiceText, getProviderUsageDisclaimerText } from '../providerLegalText.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { DropDownListBox } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { LanguageModelIcon } from './languageModelButton.js';
import { ProviderConnectionFields } from './providerConnectionFields.js';
import { ProviderModelsSection } from './providerModelsSection.js';
import { providerIconId } from '../customProviderKinds.js';
import { ProviderModalFooter } from './providerModalFooter.js';

/**
 * API types (wire protocols) offered for a custom provider. The form fixes auth
 * to an API key + base URL, so this lists the protocols whose bridge client runs
 * on an API key: anthropic-messages (anthropic client) and openai-chat /
 * openai-responses (openai-compatible client). bedrock-converse and
 * google-generative are omitted for now (Bedrock needs AWS SigV4; Gemini needs
 * the `gemini` custom client kind added to ai-config first). The companion
 * extension derives the provider `type` from the chosen protocol on save. Values
 * match ai-config's `Protocol` vocabulary.
 */
const API_TYPE_ANTHROPIC = 'anthropic-messages';
const API_TYPE_CHAT = 'openai-chat';
const API_TYPE_RESPONSES = 'openai-responses';

/**
 * API type (protocol) selection is deferred. For 2026.08 the custom provider is
 * OpenAI Chat Completions only (#15255); choosing other protocols is revisited
 * in #13817. The selector and its plumbing stay in place, gated off here, so
 * re-enabling is a one-line flip.
 */
const API_TYPE_SELECTOR_ENABLED = false;

/** The label and example request path shown for each API type in the dropdown. */
interface ApiTypeOption {
	title: string;
	path: string;
}

/**
 * Capability defaults applied to a manually listed custom model, so the user
 * only supplies the id. Mirrors the bridge's OpenAI-compatible defaults.
 */
const CUSTOM_MODEL_DEFAULTS = {
	maxContextLength: 128_000,
	supportsTools: true,
	supportsImages: false,
	supportsToolResultImages: false,
	supportsWebSearch: false,
} satisfies Omit<IPositronCustomModel, 'id' | 'name'>;

export interface ConnectProviderViewProps {
	source: IPositronLanguageModelSource;
	onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>;
	/** Invoked by the footer Back button. */
	onBack: () => void;
	/** Invoked by the footer Close button. */
	onClose: () => void;
	/**
	 * Report a way to cancel an in-flight OAuth sign-in (or `undefined` when none
	 * is pending), so dismissing the modal aborts the device flow instead of
	 * orphaning it.
	 */
	onPendingSignInChange?: (cancel: (() => void) | undefined) => void;
	/**
	 * Open providers.json for advanced editing. Closes the modal (so the editor
	 * is visible), which discards any unsaved form input, so the affordance says
	 * as much. Only wired for the custom provider create flow.
	 */
	onEditRawConfig?: () => void;
}

export const ConnectProviderView = (props: ConnectProviderViewProps) => {
	const [config] = useState<IPositronLanguageModelConfig>(() => props.source.defaults);
	const configRef = useRef(config);
	configRef.current = config;

	const [pending, setPending] = useState<'connect' | 'remove' | undefined>(undefined);
	const inFlight = pending !== undefined;
	const [errorMessage, setErrorMessage] = useState<string>();
	const [apiKey, setApiKey] = useState<string>(() => props.source.defaults.apiKey ?? '');
	const [baseUrl, setBaseUrl] = useState<string>(() => props.source.defaults.baseUrl ?? '');
	const [protocol, setProtocol] = useState<string>(() => props.source.defaults.protocol ?? API_TYPE_CHAT);
	const [modelIds, setModelIds] = useState<string[]>(() => props.source.defaults.customModels?.map(m => m.id) ?? ['']);
	const supportsBaseUrl = props.source.supportedOptions.includes('baseUrl');
	const supportsProtocol = props.source.supportedOptions.includes('protocol');
	const supportsCustomModels = props.source.supportedOptions.includes('customModels');

	// Build schema-valid custom model entries from the entered ids, defaulting
	// the capability fields the user didn't specify.
	const customModels: IPositronCustomModel[] = modelIds
		.map(id => id.trim())
		.filter(id => id.length > 0)
		.map(id => ({ id, name: id, ...CUSTOM_MODEL_DEFAULTS }));

	const apiTypeEntries = [
		new DropDownListBoxItem<string, ApiTypeOption>({ identifier: API_TYPE_ANTHROPIC, value: { title: localize('positron.connectProvider.apiType.anthropic', "Anthropic Messages"), path: '/v1/messages' } }),
		new DropDownListBoxItem<string, ApiTypeOption>({ identifier: API_TYPE_CHAT, value: { title: localize('positron.connectProvider.apiType.chat', "OpenAI Chat Completions"), path: '/v1/chat/completions' } }),
		new DropDownListBoxItem<string, ApiTypeOption>({ identifier: API_TYPE_RESPONSES, value: { title: localize('positron.connectProvider.apiType.responses', "OpenAI Responses"), path: '/v1/responses' } }),
	];

	const methods = availableAuthMethods(props.source);
	const [selectedMethod, setSelectedMethod] = useState<AuthMethod | undefined>(undefined);
	const authMethod = deriveAuthMethod(props.source, selectedMethod);
	const authStatus = deriveAuthStatus(props.source, { showProgress: inFlight, apiKey, selected: selectedMethod });

	const onConnect = async () => {
		setPending('connect');
		setErrorMessage(undefined);
		try {
			const dispatchConfig = {
				...configRef.current,
				...(authMethod === AuthMethod.API_KEY ? { apiKey } : {}),
				...(supportsBaseUrl ? { baseUrl } : {}),
				...(supportsProtocol ? { protocol } : {}),
				...(supportsCustomModels ? { customModels } : {}),
			};
			await props.onAction(props.source, dispatchConfig, deriveConnectAction(props.source, selectedMethod));
		} catch (e) {
			setErrorMessage(e instanceof Error ? e.message : String(e));
		} finally {
			setPending(undefined);
		}
	};

	// The footer Connect button: for OAuth it is disabled only while a sign-in is
	// in flight; otherwise it enables once the form input makes sign-in possible.
	const connectDisabled = authMethod === AuthMethod.OAUTH
		? authStatus === AuthStatus.SIGNING_IN
		: authStatus !== AuthStatus.SIGN_IN_PENDING;

	// Cancel an in-flight OAuth sign-in (the Posit device flow). Kept in a ref so
	// the reported handler stays stable while dispatching against the latest state.
	const cancelSignIn = () => { props.onAction(props.source, configRef.current, 'cancel'); };
	const cancelSignInRef = useRef(cancelSignIn);
	cancelSignInRef.current = cancelSignIn;

	// While an OAuth sign-in is in progress, report a cancel handler so dismissing
	// the modal aborts the flow; clear it otherwise and when this view unmounts.
	const onPendingSignInChange = props.onPendingSignInChange;
	useEffect(() => {
		const signInPending = authMethod === AuthMethod.OAUTH && inFlight;
		onPendingSignInChange?.(signInPending ? () => cancelSignInRef.current() : undefined);
	}, [onPendingSignInChange, authMethod, inFlight]);
	useEffect(() => () => onPendingSignInChange?.(undefined), [onPendingSignInChange]);

	const cancelButton = props.source.status === 'error' ? {
		title: pending === 'remove'
			? localize('positron.connectedProvider.removing', "Removing...")
			: localize('positron.connectedProvider.remove', "Remove"),
		loading: pending === 'remove',
		disable: inFlight,
		onClick: async () => {
			setPending('remove');
			setErrorMessage(undefined);
			try {
				const method = deriveAuthMethod(props.source);
				const action = method === AuthMethod.OAUTH ? 'oauth-signout' : 'delete';
				await props.onAction(props.source, props.source.defaults, action);
				props.onBack?.();
			} catch (e) {
				setErrorMessage(e instanceof Error ? e.message : String(e));
			} finally {
				setPending(undefined);
			}
		}
	} : undefined;

	return (
		<>
			<ContentArea>
				<div className='connect-provider-view' data-testid='provider-connect-view'>
					<ConnectProviderHeader source={props.source} />
					{methods.length > 1 && !props.source.signedIn &&
						<div
							aria-label={localize('positron.connectProvider.authMethodGroup', "Authentication Method")}
							className='connect-provider-auth-method'
							role='radiogroup'
						>
							{methods.map(method =>
								<label key={method}>
									<input
										checked={authMethod === method}
										disabled={inFlight}
										name='connect-provider-auth-method'
										type='radio'
										value={method}
										onChange={() => setSelectedMethod(method)}
									/>
									{method === AuthMethod.OAUTH
										? localize('positron.connectProvider.oauth', "OAuth")
										: localize('positron.connectProvider.apiKey', "API Key")}
								</label>
							)}
						</div>
					}
					<ProviderConnectionFields
						apiKey={apiKey}
						baseUrl={baseUrl}
						providerId={props.source.provider.id}
						showApiKey={authMethod === AuthMethod.API_KEY}
						showBaseUrl={supportsBaseUrl}
						onApiKeyChange={setApiKey}
						onBaseUrlChange={setBaseUrl}
					>
						{supportsProtocol && API_TYPE_SELECTOR_ENABLED &&
							<>
								<label className='connect-provider-apikey-label' id='connect-provider-apitype-label'>
									{localize('positron.connectProvider.apiTypeLabel', "API Type")}
								</label>
								<DropDownListBox
									className='connect-provider-apitype'
									createItem={item => <ApiTypeEntry option={item.options.value} />}
									entries={apiTypeEntries}
									selectedIdentifier={protocol}
									title={localize('positron.connectProvider.apiTypePlaceholder', "Select API Type")}
									onSelectionChanged={item => setProtocol(item.options.identifier)}
								/>
							</>
						}
					</ProviderConnectionFields>
					{supportsCustomModels &&
						<ProviderModelsSection
							modelIds={modelIds}
							onChange={setModelIds}
							onEditRawConfig={props.onEditRawConfig}
						/>
					}
					{errorMessage && <ProviderErrorBanner message={errorMessage} />}
					<div style={{ flexGrow: 1 }}>&nbsp;</div>
					<ProviderNotice source={props.source} />
				</div>
			</ContentArea>
			<ProviderModalFooter
				cancelButton={cancelButton}
				primaryButton={{
					title: pending === 'connect'
						? localize('positron.connectProvider.connecting', "Connecting...")
						: localize('positron.connectProvider.connect', "Connect"),
					disable: connectDisabled || inFlight,
					loading: pending === 'connect',
					onClick: onConnect,
				}}
				onBack={props.onBack}
				onClose={props.onClose}
			/>
		</>
	);
};

/** One API-type row: protocol name with its example request path dimmed alongside. */
const ApiTypeEntry = (props: { option: ApiTypeOption }) => (
	<div className='connect-provider-apitype-entry'>
		<span className='connect-provider-apitype-title'>{props.option.title}</span>
		<span className='connect-provider-apitype-path'>{props.option.path}</span>
	</div>
);

export const ConnectProviderHeader = (props: { source: IPositronLanguageModelSource; subtitle?: string }) => (
	<div className='connect-provider-header'>
		<div className='connect-provider-icon'>
			<LanguageModelIcon logoUrl={props.source.provider.logoUrl} provider={providerIconId(props.source.provider)} />
		</div>
		<div className='connect-provider-header-text'>
			<span className='connect-provider-name'>{props.source.provider.displayName}</span>
			{props.subtitle && <span className='connect-provider-subtitle'>{props.subtitle}</span>}
		</div>
	</div>
);

/** Error banner shared by the connect and connected views. */
export const ProviderErrorBanner = (props: { message: string }) => (
	<div className='connect-provider-banner error'>
		<span aria-hidden='true' className='codicon codicon-warning' />
		<span className='connect-provider-banner-message'>{props.message}</span>
	</div>
);

export const ProviderNotice = (props: { source: IPositronLanguageModelSource }) => {
	const text = [
		getProviderGettingStartedText(props.source.provider),
		getProviderTermsOfServiceText(props.source.provider),
		getProviderUsageDisclaimerText(props.source.provider),
	].filter(Boolean).join('\n\n');
	return (
		<div className='connect-provider-notice' data-testid='provider-notice'>
			<EmbeddedLink>{text}</EmbeddedLink>
		</div>
	);
};
