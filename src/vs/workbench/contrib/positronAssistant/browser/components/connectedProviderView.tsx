/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useState } from 'react';

import { localize } from '../../../../../nls.js';
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';
import { IPositronLanguageModelSource, LanguageModelAutoconfigureType } from '../../common/interfaces/positronAssistantService.js';
import { AuthMethod } from '../types.js';
import { deriveAuthMethod } from '../providerConnection.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { ConnectProviderHeader, ProviderErrorBanner, ProviderNotice } from './connectProviderView.js';
import { ProviderModalFooter } from './providerModalFooter.js';

export interface ConnectedProviderViewProps {
	source: IPositronLanguageModelSource;
	/** Disconnect the provider (OAuth sign-out or API-key removal). */
	onDisconnect: () => Promise<void>;
	/** Invoked by the footer Back button. */
	onBack: () => void;
	/** Invoked by the footer Close button. */
	onClose: () => void;
}

export const ConnectedProviderView = (props: ConnectedProviderViewProps) => {
	const [pending, setPending] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string>();

	// The source is kept fresh by the modal, which re-renders this view on every
	// provider update for it.
	const current = props.source;

	const onSignOut = async () => {
		setPending(true);
		setErrorMessage(undefined);
		try {
			await props.onDisconnect();
		} catch (e) {
			setErrorMessage(e instanceof Error ? e.message : String(e));
		} finally {
			setPending(false);
		}
	};

	// A signed-in autoconfigured provider is authenticated from the environment
	// (env var / credential chain / managed credentials), which cannot be signed
	// out from the UI - show how it authenticated instead of a Sign out button.
	const autoconfigure = current.defaults.autoconfigure;
	const isAutoAuth = !!autoconfigure && autoconfigure.signedIn;
	const envKey = autoconfigure?.type === LanguageModelAutoconfigureType.EnvVariable ? autoconfigure.key : undefined;
	const hasError = current.status === 'error';

	// GitHub Copilot rides GitHub's built-in auth, so it cannot be signed out from
	// this dialog; it stays auto-authenticated and we point the user at the
	// Accounts menu instead of offering a Disconnect button.
	const isCopilot = current.provider.id === 'copilot-auth';

	// A short line under the provider name describing how it is connected, e.g.
	// "Connected via OAuth" or "Connected via ANTHROPIC_API_KEY" for env auth.
	const authMethod = deriveAuthMethod(current);
	const subtitle = isAutoAuth && envKey
		? localize('positron.connectedProvider.viaEnv', "Connected via {0}", envKey)
		: authMethod === AuthMethod.OAUTH
			? localize('positron.connectedProvider.viaOAuth', "Connected via OAuth")
			: authMethod === AuthMethod.API_KEY
				? localize('positron.connectedProvider.viaApiKey', "Connected via API key")
				: localize('positron.connectedProvider.viaUnknown', "Connected");

	// The error banner message (only shown when the provider reports an error).
	// How the provider is connected is conveyed by the header subtitle instead.
	const errorBannerMessage = current.statusMessage
		?? localize('positron.connectedProvider.error', "This provider reported a problem with its configuration or credentials.");


	const title = authMethod === AuthMethod.OAUTH ? localize('positron.connectedProvider.signOut', "Sign Out") : localize('positron.connectedProvider.remove', "Remove");
	const loadingTitle = authMethod === AuthMethod.OAUTH
		? localize('positron.connectedProvider.signingOut', "Signing Out...")
		: localize('positron.connectedProvider.removing', "Removing...");

	return (
		<>
			<ContentArea>
				<div className='connect-provider-view'>
					<ConnectProviderHeader source={current} subtitle={subtitle} />
					<div className='connect-provider-divider' />
					{hasError && <ProviderErrorBanner message={errorBannerMessage} />}
					{isCopilot && isAutoAuth &&
						<EmbeddedLink>
							{localize('positron.connectedProvider.copilotSignOut', "To sign out of GitHub, use the [Accounts: Manage Accounts]({0}) command. This signs you out of GitHub for every extension in Positron.", 'command:workbench.action.manageAccounts')}
						</EmbeddedLink>

					}
					<p className='connect-provider-detail'>
						{current.supportedOptions.includes('baseUrl') && current.defaults.baseUrl &&
							<>
								<span className='connect-provider-detail-label'>
									{localize('positron.connectedProvider.baseUrl', "Base URL")}
								</span>
								<span className='connect-provider-detail-value'>{current.defaults.baseUrl}</span>
							</>
						}
					</p>

					<ProviderNotice source={current} />
					{errorMessage && <div className='connect-provider-error'>{errorMessage}</div>}
				</div>
			</ContentArea>
			<ProviderModalFooter
				primaryButton={isAutoAuth ? undefined : {
					title: pending ? loadingTitle : title,
					disable: pending,
					loading: pending,
					onClick: onSignOut,
				}}
				onBack={props.onBack}
				onClose={props.onClose}
			/>
		</>
	);
};
