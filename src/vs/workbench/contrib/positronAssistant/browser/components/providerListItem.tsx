/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { IPositronLanguageModelSource, LanguageModelAutoconfigureType } from '../../common/interfaces/positronAssistantService.js';
import { ProviderSectionId } from '../../common/providerGrouping.js';
import { AuthMethod } from '../types.js';
import { LanguageModelIcon, getStatusLabel } from './languageModelButton.js';

interface ProviderListItemProps {
	source: IPositronLanguageModelSource;
	/** Which section the row is rendered in; drives badges and the action label. */
	section: ProviderSectionId;
	selected: boolean;
	/** One-line description shown for not-yet-connected providers. */
	description?: string;
	/** Selects the row. The connect/manage flows (see #14818/#14819) hang off selection. */
	onSelect: () => void;
}

/** How a connected provider authenticated, shown as a badge. */
function authBadgeLabel(source: IPositronLanguageModelSource): string | undefined {
	const autoconfigure = source.defaults.autoconfigure;
	if (autoconfigure?.type === LanguageModelAutoconfigureType.EnvVariable && autoconfigure.signedIn) {
		return localize('positron.configureLLMProvidersModal.badge.environment', "Environment");
	}
	if (source.supportedOptions.includes(AuthMethod.OAUTH)) {
		return localize('positron.configureLLMProvidersModal.badge.oauth', "OAuth");
	}
	return undefined;
}

/** The per-section action button label. */
function actionLabel(section: ProviderSectionId): string {
	switch (section) {
		case 'connected':
			return localize('positron.configureLLMProvidersModal.action.edit', "Edit");
		case 'needs-attention':
			return localize('positron.configureLLMProvidersModal.action.fix', "Fix Connection");
		case 'model-providers':
			return localize('positron.configureLLMProvidersModal.action.connect', "Connect");
	}
}

/**
 * A single provider row: icon, name, status/maturity badges, and a per-section
 * action button. The whole row is selectable; the action button is a
 * placeholder that selects the row until the connect/manage flows land.
 */
export const ProviderListItem = (props: ProviderListItemProps) => {
	const { source, section, selected, description, onSelect } = props;
	const maturityLabel = getStatusLabel(source.provider.status);
	const authLabel = section === 'connected' ? authBadgeLabel(source) : undefined;

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect();
		}
	};

	return (
		<div
			aria-label={source.provider.displayName}
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
					{maturityLabel && <span className={positronClassNames('provider-list-item-badge', source.provider.status)}>{maturityLabel}</span>}
					{authLabel && <span className='provider-list-item-badge environment'>{authLabel}</span>}
					{section === 'needs-attention' &&
						<span className='provider-list-item-badge error'>
							{localize('positron.configureLLMProvidersModal.badge.error', "Error")}
						</span>
					}
				</div>
				{section === 'needs-attention' && source.statusMessage &&
					<div className='provider-list-item-error'>{source.statusMessage}</div>
				}
				{section === 'model-providers' && description &&
					<div className='provider-list-item-desc'>{description}</div>
				}
			</div>
			<div className='provider-list-item-actions'>
				<button
					className='provider-list-item-action'
					type='button'
					onClick={(e) => { e.stopPropagation(); onSelect(); }}
				>
					{actionLabel(section)}
				</button>
			</div>
		</div>
	);
};
