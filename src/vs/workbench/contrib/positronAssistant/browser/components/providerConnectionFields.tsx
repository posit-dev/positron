/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { ReactNode } from 'react';

import { localize } from '../../../../../nls.js';
import { PositronLanguageModelOptions } from '../../common/interfaces/positronAssistantService.js';
import { getBaseUrlLabel } from '../providerFieldLabels.js';

export interface ProviderConnectionFieldsProps {
	/** The provider these fields belong to. Drives the base URL label. */
	providerId: string;
	/** Whether to render the API key input. */
	showApiKey: boolean;
	/** Whether to render the base URL input. */
	showBaseUrl: boolean;
	apiKey: string;
	baseUrl: string;
	onApiKeyChange: (value: string) => void;
	onBaseUrlChange: (value: string) => void;
	/** Keeps the input ids unique when a form embeds these alongside its own. */
	idPrefix?: string;
	/** Rendered inside the field group, after the base URL. */
	children?: ReactNode;
}

/**
 * A provider's API key and base URL inputs. Shared so the Add Custom Provider
 * form shows the same inputs as the built-in it borrows from, rather than a
 * parallel set to keep in step by hand.
 */
export const ProviderConnectionFields = (props: ProviderConnectionFieldsProps) => {
	const prefix = props.idPrefix ?? 'connect-provider';

	if (!props.showApiKey && !props.showBaseUrl && !props.children) {
		return null;
	}

	return (
		<div className='connect-provider-apikey'>
			{props.showApiKey &&
				<>
					<label className='connect-provider-apikey-label' htmlFor={`${prefix}-apikey-input`}>
						{localize('positron.connectProvider.apiKeyLabel', "API Key")}
					</label>
					<input
						autoComplete='off'
						className='connect-provider-apikey-input'
						id={`${prefix}-apikey-input`}
						spellCheck={false}
						type='password'
						value={props.apiKey}
						onChange={e => props.onApiKeyChange(e.target.value)}
					/>
				</>
			}
			{props.showBaseUrl &&
				<>
					<label className='connect-provider-apikey-label' htmlFor={`${prefix}-baseurl-input`}>
						{getBaseUrlLabel(props.providerId)}
					</label>
					<input
						autoComplete='off'
						className='connect-provider-apikey-input'
						id={`${prefix}-baseurl-input`}
						spellCheck={false}
						type='text'
						value={props.baseUrl}
						onChange={e => props.onBaseUrlChange(e.target.value)}
					/>
				</>
			}
			{props.children}
		</div>
	);
};

/** True when the provider signs in with a key the user types, not OAuth. */
export function usesApiKey(supportedOptions: PositronLanguageModelOptions[]): boolean {
	return !supportedOptions.includes('oauth') && supportedOptions.includes('apiKey');
}
