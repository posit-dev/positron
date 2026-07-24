/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useEffect, useRef, useState } from 'react';

import { localize } from '../../../../../nls.js';
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { AuthMethod, AuthStatus } from '../types.js';
import { deriveAuthMethod, deriveAuthStatus } from '../providerConnection.js';
import { getProviderGettingStartedText, getProviderTermsOfServiceText, getProviderUsageDisclaimerText } from '../providerLegalText.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { LanguageModelIcon } from './languageModelButton.js';
import { ProviderModalFooter } from './providerModalFooter.js';

export interface ConnectProviderViewProps {
	source: IPositronLanguageModelSource;
	/** Connect using the config assembled from the form (API key / base URL). */
	onConnect: (config: IPositronLanguageModelConfig) => Promise<void>;
	/** Remove the provider (the Remove button shown while it is in an error state). */
	onRemove: () => Promise<void>;
	/** Abort an in-flight OAuth sign-in. */
	onCancelSignIn: () => void;
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
	const supportsBaseUrl = props.source.supportedOptions.includes('baseUrl');

	const authMethod = deriveAuthMethod(props.source);
	const authStatus = deriveAuthStatus(props.source, { showProgress: inFlight, apiKey });

	const onConnect = async () => {
		setPending('connect');
		setErrorMessage(undefined);
		try {
			const dispatchConfig = {
				...configRef.current,
				...(authMethod === AuthMethod.API_KEY ? { apiKey } : {}),
				...(supportsBaseUrl ? { baseUrl } : {}),
			};
			await props.onConnect(dispatchConfig);
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
	// the reported handler stays stable while calling the latest onCancelSignIn.
	const cancelSignInRef = useRef(props.onCancelSignIn);
	cancelSignInRef.current = props.onCancelSignIn;

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
				await props.onRemove();
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
					{(authMethod === AuthMethod.API_KEY || supportsBaseUrl) &&
						<div className='connect-provider-apikey'>
							{authMethod === AuthMethod.API_KEY &&
								<>
									<label className='connect-provider-apikey-label' htmlFor='connect-provider-apikey-input'>
										{localize('positron.connectProvider.apiKeyLabel', "API Key")}
									</label>
									<input
										autoComplete='off'
										className='connect-provider-apikey-input'
										id='connect-provider-apikey-input'
										spellCheck={false}
										type='password'
										value={apiKey}
										onChange={e => setApiKey(e.target.value)}
									/>
								</>
							}
							{supportsBaseUrl &&
								<>
									<label className='connect-provider-apikey-label' htmlFor='connect-provider-baseurl-input'>
										{localize('positron.connectProvider.baseUrlLabel', "Base URL")}
									</label>
									<input
										autoComplete='off'
										className='connect-provider-apikey-input'
										id='connect-provider-baseurl-input'
										spellCheck={false}
										type='text'
										value={baseUrl}
										onChange={e => setBaseUrl(e.target.value)}
									/>
								</>
							}
						</div>
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

export const ConnectProviderHeader = (props: { source: IPositronLanguageModelSource; subtitle?: string }) => (
	<div className='connect-provider-header'>
		<div className='connect-provider-icon'>
			<LanguageModelIcon logoUrl={props.source.provider.logoUrl} provider={props.source.provider.id} />
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
