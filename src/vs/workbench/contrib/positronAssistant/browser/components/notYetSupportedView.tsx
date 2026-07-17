/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './connectProviderView.css';

import { localize } from '../../../../../nls.js';
import { IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { ConnectProviderHeader } from './connectProviderView.js';

export interface NotYetSupportedViewProps {
	/**
	 * The provider selected, if any. Omitted for the custom-provider flow, which
	 * has no registered source yet.
	 */
	source?: IPositronLanguageModelSource;
}

/**
 * Shown when a provider's sign-in flow is not yet available in the new modal
 * (AWS region/profile, Snowflake account, GEAP, Copilot, custom providers).
 * Already-connected providers never reach this view - they use the generic
 * connected view instead.
 */
export const NotYetSupportedView = (props: NotYetSupportedViewProps) => {
	const name = props.source?.provider.displayName;
	return (
		<div className='connect-provider-view'>
			{props.source && <ConnectProviderHeader source={props.source} />}
			<p className='connect-provider-unsupported'>
				{name
					? localize('positron.notYetSupported.named', "Setting up {0} in this dialog is not supported yet. Configure it in Settings for now.", name)
					: localize('positron.notYetSupported.generic', "Setting up this provider in this dialog is not supported yet. Configure it in Settings for now.")}
			</p>
		</div>
	);
};
