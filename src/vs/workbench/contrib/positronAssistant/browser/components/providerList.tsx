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

/**
 * One-line provider descriptions shown for not-yet-connected providers, keyed by
 * provider id. Positron provider metadata does not carry a description yet, so
 * this static map mirrors the copy from the provider-configuration design
 * prototype. Missing ids simply render no description.
 */
const PROVIDER_DESCRIPTIONS: Record<string, string> = {
	'amazon-bedrock': localize('positron.configureLLMProvidersModal.desc.bedrock', "Access Claude and other models via AWS"),
	'anthropic-api': localize('positron.configureLLMProvidersModal.desc.anthropic', "Access Claude models directly via Anthropic API"),
	'copilot-auth': localize('positron.configureLLMProvidersModal.desc.copilot', "AI models via GitHub Copilot subscription"),
	'deepseek-api': localize('positron.configureLLMProvidersModal.desc.deepseek', "Access DeepSeek reasoning models"),
	'google': localize('positron.configureLLMProvidersModal.desc.google', "Access Gemini models via Google AI Studio"),
	'google-cloud': localize('positron.configureLLMProvidersModal.desc.googleCloud', "Gemini via Google Cloud with enterprise features"),
	'ms-foundry': localize('positron.configureLLMProvidersModal.desc.msFoundry', "Access Azure OpenAI and AI Studio models"),
	'openai-api': localize('positron.configureLLMProvidersModal.desc.openai', "GPT-4o, o1, and OpenAI-compatible endpoints"),
	'posit-ai': localize('positron.configureLLMProvidersModal.desc.positAI', "Managed model service for Positron Desktop"),
	'snowflake-cortex': localize('positron.configureLLMProvidersModal.desc.snowflake', "Access LLMs via Snowflake data platform"),
};

/** Localized heading per section id. */
function sectionTitle(id: ProviderSectionId): string {
	switch (id) {
		case 'connected':
			return localize('positron.configureLLMProvidersModal.section.connected', "Connected Providers");
		case 'needs-attention':
			return localize('positron.configureLLMProvidersModal.section.needsAttention', "Needs Attention");
		case 'model-providers':
			return localize('positron.configureLLMProvidersModal.section.modelProviders', "Model Providers");
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
							description={PROVIDER_DESCRIPTIONS[item.provider.id]}
							section={section.id}
							selected={item.provider.id === selectedProviderId}
							source={item}
							onSelect={() => setSelectedProviderId(item.provider.id)}
						/>
					))}
				</div>
			))}

			<div className='provider-list-section'>
				<label className='provider-list-section-heading'>
					{localize('positron.configureLLMProvidersModal.section.custom', "Custom Provider")}
					<span className='provider-list-item-badge experimental'>
						{localize('positron.configureLLMProvidersModal.badge.experimental', "Experimental")}
					</span>
				</label>
				<p className='provider-list-custom-desc'>
					{localize('positron.configureLLMProvidersModal.customDescription', "Works with any OpenAI-compatible API endpoint that uses the /v1/chat/completions endpoint for chat.")}
				</p>
				{/* Placeholder until the custom-provider flow lands (see #14818). */}
				<button className='provider-list-add-custom' type='button'>
					{localize('positron.configureLLMProvidersModal.addCustom', "Add custom provider")}
				</button>
			</div>
		</div>
	);
};
