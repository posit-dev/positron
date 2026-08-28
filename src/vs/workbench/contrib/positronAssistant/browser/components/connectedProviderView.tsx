/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { useState } from 'react';

import { localize } from '../../../../../nls.js';
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, LanguageModelAutoconfigureType } from '../../common/interfaces/positronAssistantService.js';
import { AuthMethod } from '../types.js';
import { deriveAuthMethod, deriveDisconnectAction } from '../providerConnection.js';
import { getBaseUrlLabel } from '../providerFieldLabels.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ConnectProviderHeader, ProviderErrorBanner, ProviderNotice } from './connectProviderView.js';
import { EditRawConfigLink } from './editRawConfigLink.js';
import { ProviderModalFooter } from './providerModalFooter.js';

export interface ConnectedProviderViewProps {
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
	/** Open providers.json for advanced editing. */
	onEditRawConfig: () => void;
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
			await props.onAction(current, current.defaults, deriveDisconnectAction(current));
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
	const customMessage = autoconfigure?.type === LanguageModelAutoconfigureType.Custom ? autoconfigure.message : undefined;
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
		: isAutoAuth && customMessage
			? localize('positron.connectedProvider.viaCustom', "Connected via {0}", customMessage)
			: authMethod === AuthMethod.OAUTH
				? localize('positron.connectedProvider.viaOAuth', "Connected via OAuth")
				: authMethod === AuthMethod.API_KEY
					? localize('positron.connectedProvider.viaApiKey', "Connected via API key")
					: localize('positron.connectedProvider.viaUnknown', "Connected");

	// The error banner message (only shown when the provider reports an error).
	// How the provider is connected is conveyed by the header subtitle instead.
	const errorBannerMessage = current.statusMessage
		?? localize('positron.connectedProvider.error', "This provider reported a problem with its configuration or credentials.");


	// "Disconnect", not "Remove": it clears the stored credential and leaves the
	// provider in the list with its settings intact. Deleting a custom entry is a
	// different action, and the two must not read the same.
	const actionTitle = authMethod === AuthMethod.OAUTH ? localize('positron.connectedProvider.signOut', "Sign Out") : localize('positron.connectedProvider.disconnect', "Disconnect");
	const actionLoadingTitle = authMethod === AuthMethod.OAUTH
		? localize('positron.connectedProvider.signingOut', "Signing Out...")
		: localize('positron.connectedProvider.disconnecting', "Disconnecting...");

	// Which read-only detail rows this provider has a value for. Hoisted so the
	// group wrapper can tell whether any row will render at all.
	const showBaseUrl = current.supportedOptions.includes('baseUrl') && !!current.defaults.baseUrl;
	const showAwsProfile = current.supportedOptions.includes('aws') && !!current.defaults.aws?.profile;
	const showAwsRegion = current.supportedOptions.includes('aws') && !!current.defaults.aws?.region;
	const hasDetails = showBaseUrl || showAwsProfile || showAwsRegion;

	return (
		<PositronDynamicModalDialog
			content={
				<div className='connect-provider-view' data-testid='provider-connected-view'>
					<ConnectProviderHeader source={current} subtitle={subtitle} />
					{hasError && <ProviderErrorBanner message={errorBannerMessage} />}
					{isCopilot && isAutoAuth &&
						<EmbeddedLink>
							{localize('positron.connectedProvider.copilotSignOut', "To sign out of GitHub, use the [Accounts: Manage Accounts]({0}) command. This signs you out of GitHub for every extension in Positron.", 'command:workbench.action.manageAccounts')}
						</EmbeddedLink>
					}
					{/* Rendered only when there is something to show, since a flex gap
						applies to an empty child too and would space the header off the
						notice for every provider without details. AWS rows appear only when
						saved in providers.json -- a value coming from AWS_PROFILE /
						AWS_REGION is deliberately absent, matching the connect form. */}
					{hasDetails &&
						<div className='connect-provider-details' data-testid='provider-details'>
							{showBaseUrl &&
								<div className='connect-provider-detail' data-testid='provider-base-url'>
									<span className='connect-provider-detail-label'>
										{getBaseUrlLabel(current.provider.id)}
									</span>
									<span className='connect-provider-detail-value'>{current.defaults.baseUrl}</span>
								</div>
							}
							{showAwsProfile &&
								<div className='connect-provider-detail' data-testid='provider-aws-profile'>
									<span className='connect-provider-detail-label'>
										{localize('positron.connectedProvider.awsProfile', "AWS Profile")}
									</span>
									<span className='connect-provider-detail-value'>{current.defaults.aws?.profile}</span>
								</div>
							}
							{showAwsRegion &&
								<div className='connect-provider-detail' data-testid='provider-aws-region'>
									<span className='connect-provider-detail-label'>
										{localize('positron.connectedProvider.awsRegion', "AWS Region")}
									</span>
									<span className='connect-provider-detail-value'>{current.defaults.aws?.region}</span>
								</div>
							}
						</div>
					}
					<EditRawConfigLink onClick={props.onEditRawConfig} />
					<ProviderNotice source={current} />
					{errorMessage && <div className='connect-provider-error'>{errorMessage}</div>}
				</div>
			}
			footer={
				<ProviderModalFooter
					primaryButton={isAutoAuth ? undefined : {
						title: pending ? actionLoadingTitle : actionTitle,
						disable: pending,
						loading: pending,
						onClick: onSignOut,
					}}
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
