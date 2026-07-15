/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { LanguageModelIcon, getStatusLabel } from './languageModelButton.js';

interface ProviderListItemProps {
	source: IPositronLanguageModelSource;
	selected: boolean;
	/** When false (e.g. the Needs Attention section), the status line is suppressed. */
	showStatus: boolean;
	onSelect: () => void;
}

/** grey (not connected) / green (ok or signed in) / red (error). */
function statusDotClass(source: IPositronLanguageModelSource): string {
	if (source.status === 'error') {
		return 'error';
	}
	if (source.signedIn || source.status === 'ok') {
		return 'connected';
	}
	return 'disconnected';
}

/** Prefer the provider-supplied message; fall back to a generic connected/not-connected string. */
function statusText(source: IPositronLanguageModelSource): string {
	if (source.statusMessage) {
		return source.statusMessage;
	}
	return source.signedIn
		? localize('positron.configureLLMProvidersModal.connected', "Connected")
		: localize('positron.configureLLMProvidersModal.notConnected', "Not connected");
}

/** A single provider row: icon, name, maturity label, and (optionally) connection status. */
export const ProviderListItem = (props: ProviderListItemProps) => {
	const { source, selected, showStatus, onSelect } = props;
	const maturityLabel = getStatusLabel(source.provider.status);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect();
		}
	};

	return (
		<div
			className={positronClassNames('provider-list-item', { selected })}
			role='button'
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={onKeyDown}
		>
			<LanguageModelIcon logoUrl={source.provider.logoUrl} provider={source.provider.id} />
			<div className='provider-list-item-text'>
				<div className='provider-list-item-name'>
					<span className='provider-list-item-display-name'>{source.provider.displayName}</span>
					{maturityLabel && <span className='provider-list-item-label'>{maturityLabel}</span>}
				</div>
				{showStatus &&
					<div className='provider-list-item-status'>
						<span className={positronClassNames('provider-list-item-status-dot', statusDotClass(source))} />
						<span className='provider-list-item-status-text'>{statusText(source)}</span>
					</div>
				}
			</div>
		</div>
	);
};
