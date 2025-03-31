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
	onChange: (config: IPositronLanguageModelConfig) => void,
	onSignIn: () => void,
}

export const LanguageModelConfigComponent = (props: LanguageModelConfigComponentProps) => {
	function getTos(provider: string) {
		switch (provider) {
			case 'anthropic':
				return localize('positron.newConnectionModalDialog.anthropicTos',
					"By using Anthropic, you agree to abide by their [Consumer](https://www.anthropic.com/legal/consumer-terms) or [Commercial](https://www.anthropic.com/legal/commercial-terms) terms of service.");
			case 'google':
				return localize('positron.newConnectionModalDialog.googleTos',
					"By using Gemini, you agree to abide by their [Terms of Service](https://gemini.google/policy-guidelines).");
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
			<SignInButton signedIn={props.source.signedIn} onSignIn={props.onSignIn} />
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

const SignInButton = (props: { signedIn?: boolean, onSignIn: () => void }) => {
	return <Button className='language-model button sign-in' onPressed={props.onSignIn}>
		{(() => {
			if (props.signedIn) {
				return localize('positron.newConnectionModalDialog.signOut', "Sign out");
			} else {
				return localize('positron.newConnectionModalDialog.signIn', "Sign in");
			}
		})()}
	</Button>
}
