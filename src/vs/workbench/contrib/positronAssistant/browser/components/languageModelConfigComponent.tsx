/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react'
import { IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js'
import { localize } from '../../../../../nls.js'
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js'
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js'
import { LanguageModelUIConfiguration } from '../languageModelModalDialog.js'
import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js'

interface LanguageModelConfigComponentProps {
	provider: LanguageModelUIConfiguration,
	source: IPositronLanguageModelSource,
	signingIn?: boolean,
	onChange: (config: IPositronLanguageModelConfig) => void,
	onSignIn: () => void,
}

const TOS_TEMPLATE = `{0} is considered "Third Party Materials" as defined in the [Posit EULA](https://posit.co/about/eula/)
and subject to the {0} terms of service at {1} and privacy policy at {2}.\n\n
Your use of {0} is optional and at your sole risk.`

export const LanguageModelConfigComponent = (props: LanguageModelConfigComponentProps) => {
	function getTos(provider: string) {
		switch (provider) {
			case 'anthropic':
				return localize('positron.newConnectionModalDialog.tos', TOS_TEMPLATE,
					'Anthropic',
					'[Terms of Service](https://www.anthropic.com/legal/consumer-terms)',
					'[Privacy Policy](https://www.anthropic.com/legal/privacy)');
			case 'google':
				return localize('positron.newConnectionModalDialog.tos', TOS_TEMPLATE,
					'Google Gemini',
					'[Terms of Service](https://gemini.google/policy-guidelines)',
					'[Privacy Policy](https://policies.google.com/privacy)'
				);
			case 'copilot':
				return localize('positron.newConnectionModalDialog.tos', TOS_TEMPLATE,
					'Copilot',
					'[Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)',
					'[Privacy Policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement#personal-data-we-collect)'
				);
			default:
				return '';
		}
	}

	return (<>
		<div className='language-model-container input'>
			{props.source.supportedOptions.includes('apiKey') && !props.source.signedIn && (
				<ApiKey apiKey={props.provider.apiKey} signedIn={props.source.signedIn} onChange={(newApiKey) => {
					props.onChange({ ...props.provider, apiKey: newApiKey });
				}} onSignIn={props.onSignIn} />
			)}
			<SignInButton signedIn={props.source.signedIn} onSignIn={props.onSignIn} signingIn={props.signingIn} />
		</div>
		<div className='language-model-dialog-tos' id='model-tos'>
			<EmbeddedLink>{getTos(props.provider.provider)}</EmbeddedLink>
		</div>
	</>)
}

// Language config parts
const ApiKey = (props: { apiKey?: string, signedIn?: boolean, onChange: (newApiKey: string) => void, onSignIn: () => void }) => {
	return (<>
		<div className='language-model-authentication-container' id='api-key-input'>
			<LabeledTextInput
				disabled={props.signedIn}
				label={(() => localize('positron.newConnectionModalDialog.apiKey', "API Key"))()}
				type='password'
				value={props.apiKey ?? ''}
				onChange={e => { props.onChange(e.currentTarget.value) }} />
		</div>
	</>)
}

const SignInButton = (props: { signedIn?: boolean, signingIn?: boolean, onSignIn: () => void }) => {
	return <Button className='language-model button sign-in' onPressed={props.onSignIn} disabled={props.signingIn}>
		{(() => {
			if (props.signedIn) {
				return localize('positron.newConnectionModalDialog.signOut', "Sign out");
			} else {
				return localize('positron.newConnectionModalDialog.signIn', "Sign in");
			}
		})()}
	</Button>
}
