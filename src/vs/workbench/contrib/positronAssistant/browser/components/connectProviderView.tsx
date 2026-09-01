/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useEffect, useRef, useState } from 'react';

import { localize } from '../../../../../nls.js';
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';
import { IPositronCustomModel, IPositronLanguageModelConfig, IPositronLanguageModelFieldOverride, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { AuthMethod, AuthStatus } from '../types.js';
import { availableAuthMethods, deriveAuthMethod, deriveAuthStatus, deriveConnectAction } from '../providerConnection.js';
import { getProviderGettingStartedText } from '../providerLegalText.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { DropDownListBox } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { EditRawConfigLink } from './editRawConfigLink.js';
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

/** Props for {@link AwsField}. */
interface AwsFieldProps {
	/** Input element id, tied to the label and used by tests. */
	id: string;
	label: string;
	/** `data-testid` for the override note, so a test can read the message. */
	noteTestId: string;
	/** The value saved in providers.json, shown when the field is editable. */
	value: string;
	/**
	 * What AWS falls back to when the box is left empty. Not localized: it is an
	 * identifier AWS matches literally, not prose. Never visible while the field
	 * is overridden, since the box then holds the value in effect.
	 */
	placeholder?: string;
	/** Set when a higher-precedence layer supplies the field; makes it read-only. */
	override: IPositronLanguageModelFieldOverride | undefined;
	onChange: (value: string) => void;
}

/**
 * One AWS credential-chain input.
 *
 * When the environment supplies the field, the box shows the value in effect
 * instead of the saved one and a note names the variable and how to get the
 * saved value back. The input is kept rather than swapped for a plain value row
 * because the removed affordance is the message: this is the field you would
 * normally edit, and here is what took it over. Keeping it also holds the
 * form's shape steady across launches instead of reflowing based on the user's
 * shell.
 *
 * `readOnly` rather than `disabled`: a read-only input stays focusable and
 * announced by a screen reader, and its text can be selected and copied --
 * which matters for a value the user may want to paste into an AWS CLI call.
 */
const AwsField = (props: AwsFieldProps) => {
	const override = props.override;
	// A saved value only worth mentioning when something is standing over it.
	const shadowedSavedValue = override ? props.value : '';
	const source = override?.name
		?? localize('positron.connectProvider.overrideSourceEnv', "an environment variable");

	return (
		// Grouped rather than returned as a fragment: as direct children of the
		// section, a label sat no closer to its own input than to the next
		// field's label, so nothing read as belonging together.
		<div className='connect-provider-aws-field'>
			<label className='connect-provider-apikey-label' htmlFor={props.id}>
				{props.label}
			</label>
			<input
				autoComplete='off'
				className='connect-provider-apikey-input'
				id={props.id}
				placeholder={props.placeholder}
				readOnly={!!override}
				spellCheck={false}
				type='text'
				value={override?.value ?? props.value}
				onChange={e => props.onChange(e.target.value)}
			/>
			{override &&
				<p className='connect-provider-field-override' data-testid={props.noteTestId}>
					{shadowedSavedValue
						// The shadowed value is arbitrary user text, so it ends the
						// note as a monospace element rather than being interpolated:
						// "your saved value claude" gives no clue where the prose
						// stops and the value starts. The variable name stays
						// interpolated -- SCREAMING_CASE already reads as an
						// identifier.
						? <>
							{localize('positron.connectProvider.usingEnvVarWithSaved', "Using {0}. Unset it to use your saved value:", source)}
							{' '}
							<code className='connect-provider-override-value'>{shadowedSavedValue}</code>
						</>
						: localize('positron.connectProvider.usingEnvVar', "Using {0}.", source)}
				</p>
			}
		</div>
	);
};

export interface ConnectProviderViewProps {
	/** The renderer this view draws its dialog box into. */
	renderer: PositronModalReactRenderer;
	/** The dialog title, computed by the modal so every view titles itself the same way. */
	title: string;
	/** The dialog width, set by the modal so every view is the same size. */
	width: number;
	source: IPositronLanguageModelSource;
	onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>;
	/** Invoked by the footer Back button. */
	onBack: () => void;
	/**
	 * Open providers.json for advanced editing. Closes the modal (so the editor
	 * is visible), which discards any unsaved form input, so the affordance says
	 * as much.
	 */
	onEditRawConfig: () => void;
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
	const [awsProfile, setAwsProfile] = useState<string>(() => props.source.defaults.aws?.profile ?? '');
	const [awsRegion, setAwsRegion] = useState<string>(() => props.source.defaults.aws?.region ?? '');
	const [protocol, setProtocol] = useState<string>(() => props.source.defaults.protocol ?? API_TYPE_CHAT);
	const [modelIds, setModelIds] = useState<string[]>(() => props.source.defaults.customModels?.map(m => m.id) ?? ['']);
	const supportsBaseUrl = props.source.supportedOptions.includes('baseUrl');
	const supportsProtocol = props.source.supportedOptions.includes('protocol');
	const supportsCustomModels = props.source.supportedOptions.includes('customModels');
	const supportsAws = props.source.supportedOptions.includes('aws');
	// Environment variables outrank providers.json in ai-config's precedence
	// stack, so a field named here is not something this form can set.
	const awsProfileOverride = props.source.overrides?.aws?.profile;
	const awsRegionOverride = props.source.overrides?.aws?.region;

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

	// Switching method drops the last failure, which belonged to the method the user
	// just moved away from. The field values stay: the user may be coming back.
	const onSelectMethod = (method: AuthMethod) => {
		setSelectedMethod(method);
		setErrorMessage(undefined);
	};
	const authMethod = deriveAuthMethod(props.source, selectedMethod);
	const authStatus = deriveAuthStatus(props.source, { showProgress: inFlight, apiKey, selected: selectedMethod });

	// Editable AWS fields, empty boxes included: an empty box means "remove this
	// saved value". Safe because the boxes are pre-filled from providers.json
	// alone, so submitting them back can only ever write what the user set or
	// cleared here.
	//
	// An overridden field is omitted rather than submitted, which the save
	// helper reads as "leave alone". Submitting its displayed value would
	// persist an environment variable that may not be set next launch, and
	// submitting an empty string would delete whatever the user saved
	// underneath it. With both overridden this is empty: nothing to write.
	const awsToSave = {
		...(supportsAws && !awsProfileOverride ? { profile: awsProfile.trim() } : {}),
		...(supportsAws && !awsRegionOverride ? { region: awsRegion.trim() } : {}),
	};

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
				// Rebuilt rather than inherited: `defaults.aws` carries the saved
				// values, and an overridden field must not ride along in the
				// spread above. Empty when the environment supplies both, which
				// the save handler reads as nothing to write.
				...(supportsAws ? { aws: awsToSave } : {}),
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

	// Cancel an in-flight OAuth sign-in.
	const cancelSignIn = () => {
		props.onAction(props.source, configRef.current, 'cancel');
	};

	const cancelSignInRef = useRef(cancelSignIn);
	cancelSignInRef.current = cancelSignIn;

	// Whether an OAuth sign-in is running, read by the unmount cleanup below.
	const oauthSignInInProgressRef = useRef(false);
	oauthSignInInProgressRef.current = authMethod === AuthMethod.OAUTH && inFlight;

	// Every way out of this view unmounts it: Back, the title bar close button, and
	// Escape, which the browser handles itself without going through React. Hanging
	// the cancel off the unmount covers all of them once.
	useEffect(() => {
		return () => {
			if (oauthSignInInProgressRef.current) {
				cancelSignInRef.current();
			}
		};
	}, []);

	const removeButton = props.source.status === 'error' ? {
		title: pending === 'remove'
			? localize('positron.connectedProvider.disconnecting', "Disconnecting...")
			: localize('positron.connectedProvider.disconnect', "Disconnect"),
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
		<PositronDynamicModalDialog
			content={
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
										onChange={() => onSelectMethod(method)}
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
						// supportsBaseUrl says this provider has a base URL, not whether
						// it's user-editable (an admin-enforced one shouldn't be). No such
						// case exists yet: ai-config has no per-field provenance signal
						// (https://github.com/posit-dev/ai-lib/issues/90), and this input
						// has no disabled state regardless.
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
					{supportsAws &&
						<div className='connect-provider-aws'>
							<AwsField
								id='connect-provider-aws-profile-input'
								label={localize('positron.connectProvider.awsProfileLabel', "AWS Profile")}
								noteTestId='aws-profile-override'
								override={awsProfileOverride}
								// The profile AWS looks for in ~/.aws/config when none is
								// given. A fixed convention, unlike the region, which has no
								// default worth promising. Only what AWS *looks for*, not a
								// guarantee: the credential chain tries environment keys
								// first and may never read a profile at all.
								placeholder='default'
								value={awsProfile}
								onChange={setAwsProfile}
							/>
							<AwsField
								id='connect-provider-aws-region-input'
								label={localize('positron.connectProvider.awsRegionLabel', "AWS Region")}
								noteTestId='aws-region-override'
								override={awsRegionOverride}
								value={awsRegion}
								onChange={setAwsRegion}
							/>
							{/* Only describes the boxes the user can still fill in. With
								both editable neither variable is set, so naming them is
								both accurate and the only place they're discoverable;
								with one overridden its own note already names it, and
								repeating the pair here would imply the set one is still
								a fallback. With neither editable there is nothing to
								leave blank, so the hint goes away entirely -- the
								per-field notes carry the whole story. */}
							{/* {(!awsProfileOverride || !awsRegionOverride) &&
								<p className='connect-provider-aws-hint'>
									{!awsProfileOverride && !awsRegionOverride
										? localize('positron.connectProvider.awsHint', "Leave blank to use the AWS_PROFILE and AWS_REGION environment variables, or your AWS defaults.")
										: localize('positron.connectProvider.awsHintDefaults', "Leave blank to use your AWS defaults.")}
								</p>
							} */}
						</div>
					}
					{supportsCustomModels &&
						<ProviderModelsSection
							modelIds={modelIds}
							onChange={setModelIds}
						/>
					}
					{errorMessage && <ProviderErrorBanner message={errorMessage} />}
					<div style={{ flexGrow: 1 }}>&nbsp;</div>
					<EditRawConfigLink onClick={props.onEditRawConfig} />
					<ProviderNotice source={props.source} />
				</div>
			}
			footer={
				<ProviderModalFooter
					primaryButton={{
						title: pending === 'connect'
							? localize('positron.connectProvider.connecting', "Connecting...")
							: localize('positron.connectProvider.connect', "Connect"),
						disable: connectDisabled || inFlight,
						loading: pending === 'connect',
						submit: true,
						onClick: onConnect,
					}}
					secondaryButton={removeButton}
					onBack={props.onBack}
				/>
			}
			renderer={props.renderer}
			title={props.title}
			width={props.width}
			onCancel={() => props.renderer.dispose()}
		/>
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
			<LanguageModelIcon monochrome logoUrl={props.source.provider.logoUrl} provider={providerIconId(props.source.provider)} />
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
	const text = getProviderGettingStartedText(props.source.provider);
	if (!text) {
		return null;
	}
	return (
		<div className='connect-provider-notice' data-testid='provider-notice'>
			<EmbeddedLink>{text}</EmbeddedLink>
		</div>
	);
};
