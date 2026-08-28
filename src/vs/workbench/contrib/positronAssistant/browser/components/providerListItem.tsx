/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IPositronLanguageModelSource, LanguageModelAutoconfigureType } from '../../common/interfaces/positronAssistantService.js';
import { ProviderSectionId } from '../../common/providerGrouping.js';
import { deriveAuthMethod } from '../providerConnection.js';
import { AuthMethod } from '../types.js';
import { LanguageModelIcon, getStatusLabel } from './languageModelButton.js';
import { providerIconId } from '../customProviderKinds.js';

interface ProviderListItemProps {
	source: IPositronLanguageModelSource;
	/** Which section the row is rendered in; drives badges and the action label. */
	section: ProviderSectionId;
	/** One-line description shown for not-yet-connected providers. */
	description?: string;
	/** Invoked by the row's action button. The connect/manage flows (see #14818/#14819) hang off this. */
	onAction?: () => void;
}

/** How a connected provider authenticated, shown as a badge. */
function authBadgeLabel(source: IPositronLanguageModelSource): string | undefined {
	const autoconfigure = source.defaults.autoconfigure;
	if (autoconfigure?.type === LanguageModelAutoconfigureType.EnvVariable && autoconfigure.signedIn) {
		return localize('positron.configureLLMProvidersModal.badge.environment', "Environment");
	}
	if (autoconfigure?.type === LanguageModelAutoconfigureType.Custom && autoconfigure.signedIn &&
		autoconfigure.isPositWorkbench) {
		return localize('positron.configureLLMProvidersModal.badge.pwbManaged', "PWB Managed");
	}
	if (deriveAuthMethod(source) === AuthMethod.OAUTH) {
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
		case 'custom':
			return localize('positron.configureLLMProvidersModal.action.connect', "Connect");
	}
}

/**
 * A single provider row: a rounded-square provider icon, name, status/maturity
 * badges, and a per-section action button (the only interactive element - the
 * row itself is not clickable).
 */
export const ProviderListItem = (props: ProviderListItemProps) => {
	const { source, section, description, onAction } = props;
	// A custom entry is always shown as experimental, regardless of any status
	// its metadata carries: the custom-provider feature itself is still evolving.
	const maturityStatus = source.provider.customKind ? 'experimental' : source.provider.status;
	const maturityLabel = getStatusLabel(maturityStatus);
	const authLabel = section === 'connected' ? authBadgeLabel(source) : undefined;

	return (
		<div className='provider-list-item' data-provider-section={section} data-testid={`provider-row-${source.provider.id}`}>
			<div className='provider-list-item-icon'>
				<LanguageModelIcon logoUrl={source.provider.logoUrl} provider={providerIconId(source.provider)} />
			</div>
			<div className='provider-list-item-text'>
				<div className='provider-list-item-name'>
					<span className='provider-list-item-display-name'>{source.provider.displayName}</span>
					{source.provider.customKind &&
						<span className='provider-list-item-badge'>
							{localize('positron.configureLLMProvidersModal.badge.custom', "Custom")}
						</span>
					}
					{maturityLabel && <span className='provider-list-item-badge'>{maturityLabel}</span>}
					{authLabel && <span className='provider-list-item-badge'>{authLabel}</span>}
					{section === 'needs-attention' &&
						<span className='provider-list-item-badge error'>
							{localize('positron.configureLLMProvidersModal.badge.error', "Error")}
						</span>
					}
				</div>
				{section === 'needs-attention' && source.statusMessage &&
					<div className='provider-list-item-error'>{source.statusMessage}</div>
				}
				{(section === 'model-providers' || section === 'custom') && description &&
					<div className='provider-list-item-desc'>{description}</div>
				}
			</div>
			<div className='provider-list-item-actions'>
				<button className='provider-list-item-action' data-testid={`provider-action-${source.provider.id}`} type='button' onClick={onAction}>
					{(section === 'model-providers' || section === 'custom') && <span aria-hidden='true' className='codicon codicon-add' />}
					{actionLabel(section)}
				</button>
			</div>
		</div>
	);
};
