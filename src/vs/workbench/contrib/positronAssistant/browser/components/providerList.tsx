/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';

import { localize } from '../../../../../nls.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../../common/interfaces/positronAssistantService.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { groupProviders, ProviderSectionId } from '../../common/providerGrouping.js';
import { syncAuthSessions } from '../languageModelSessionSync.js';
import { ProviderListItem } from './providerListItem.js';

interface ProviderListProps {
	sources: IPositronLanguageModelSource[];
	options?: IShowLanguageModelConfigOptions;
}

/** Localized heading per section id. */
function sectionTitle(id: ProviderSectionId): string {
	switch (id) {
		case 'needs-attention':
			return localize('positron.configureLLMProvidersModal.section.needsAttention', "Providers needing attention");
		case 'connected':
			return localize('positron.configureLLMProvidersModal.section.connected', "Connected");
		case 'custom':
			return localize('positron.configureLLMProvidersModal.section.custom', "Custom Providers");
		case 'approved':
			return localize('positron.configureLLMProvidersModal.section.approved', "Approved Providers");
		case 'available':
			return localize('positron.configureLLMProvidersModal.section.available', "Available Providers");
	}
}

/** The grouped, sectioned provider list shown in the Configure LLM Providers modal. */
export const ProviderList = (props: ProviderListProps) => {
	const services = usePositronReactServicesContext();

	// Local copy of sources so live auth/config changes re-render the list.
	const [sources, setSources] = useState<IPositronLanguageModelSource[]>(props.sources);
	const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(props.options?.preselectedProviderId);

	// Re-sync if the caller hands us a new sources array.
	useEffect(() => setSources(props.sources), [props.sources]);

	// Provider config changes (sign in / out) while the modal is open.
	useEffect(() => {
		const configService = services.get(IPositronAssistantConfigurationService);
		const disposables: IDisposable[] = [];
		disposables.push(configService.onChangeProviderConfig(newSource => {
			setSources(prev => prev.map(s => s.provider.id === newSource.provider.id ? newSource : s));
		}));
		return () => disposables.forEach(d => d.dispose());
	}, [services]);

	// Auth session changes for API-key providers.
	useEffect(() => {
		const authService = services.get(IAuthenticationService);
		const disposable = syncAuthSessions(
			authService,
			props.sources.map(s => s.provider.id),
			(providerId, signedIn) => {
				setSources(prev => {
					const index = prev.findIndex(s => s.provider.id === providerId);
					if (index === -1) {
						return prev;
					}
					const next = [...prev];
					next[index] = { ...prev[index], signedIn };
					return next;
				});
			}
		);
		return () => disposable.dispose();
	}, [services, props.sources]);

	const sections = groupProviders(sources);

	return (
		<div className='provider-list'>
			{sections.map(section => (
				<div key={section.id} className='provider-list-section'>
					<label className='provider-list-section-heading'>{sectionTitle(section.id)}</label>
					{section.items.map(item => (
						<ProviderListItem
							key={item.provider.id}
							selected={item.provider.id === selectedProviderId}
							showStatus={section.id !== 'needs-attention'}
							source={item}
							onSelect={() => setSelectedProviderId(item.provider.id)}
						/>
					))}
				</div>
			))}
		</div>
	);
};
