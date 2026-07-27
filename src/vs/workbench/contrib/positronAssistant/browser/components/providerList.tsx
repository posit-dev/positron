/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IPositronLanguageModelSource } from '../../common/interfaces/positronAssistantService.js';
import { groupProviders, ProviderSectionId } from '../../common/providerGrouping.js';
import { ProviderListItem } from './providerListItem.js';

interface ProviderListProps {
	sources: IPositronLanguageModelSource[];
	/** Invoked when a provider row's action fires; the modal routes to connect / connected / not-supported. */
	onSelectProvider: (source: IPositronLanguageModelSource) => void;
	/** Invoked when the "Add custom provider" button is clicked. */
	onAddCustomProvider: () => void;
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
	const sections = groupProviders(props.sources);

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
							source={item}
							onAction={() => props.onSelectProvider(item)}
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
				<button className='provider-list-add-custom' type='button' onClick={props.onAddCustomProvider}>
					<span aria-hidden='true' className='codicon codicon-add' />
					{localize('positron.configureLLMProvidersModal.addCustom', "Add custom provider")}
				</button>
			</div>
		</div>
	);
};
