/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronLanguageModelSource } from './interfaces/positronAssistantService.js';

/** Section identifiers for the built-in provider groups, in fixed display order. */
export type ProviderSectionId = 'connected' | 'needs-attention' | 'model-providers';

/** A non-empty group of providers to render under one heading. */
export interface ProviderSection {
	id: ProviderSectionId;
	items: IPositronLanguageModelSource[];
}

const SECTION_ORDER: ProviderSectionId[] = ['connected', 'needs-attention', 'model-providers'];

/**
 * The OpenAI-compatible "Custom Provider" template. It has its own dedicated
 * section in the modal (with an "Add custom provider" affordance), so it is
 * excluded from the built-in provider groups.
 */
export const CUSTOM_PROVIDER_ID = 'openai-compatible';

/** Only chat providers (and the copilot-auth completion provider) are shown, mirroring the legacy modal. */
function isDisplayable(source: IPositronLanguageModelSource): boolean {
	if (source.provider.id === CUSTOM_PROVIDER_ID) {
		return false;
	}
	return source.type === 'chat' || (source.type === 'completion' && source.provider.id === 'copilot-auth');
}

/** Which section a source belongs to, based on sign-in and connection status. */
function sectionFor(source: IPositronLanguageModelSource): ProviderSectionId {
	// An error is surfaced regardless of sign-in state: the "Authentication
	// expired" case is reported with signedIn === false (a configured provider
	// whose credential no longer resolves), so it must still land here rather
	// than looking like a fresh, unconfigured provider.
	if (source.status === 'error') {
		return 'needs-attention';
	}
	if (source.signedIn) {
		return 'connected';
	}
	return 'model-providers';
}

/**
 * Sort rank within a section: Posit AI first, then stable providers (no
 * status), then preview, then experimental. Mirrors the legacy modal's
 * providerSortRank (languageModelModalDialog.tsx) so both dialogs order
 * providers identically.
 */
function providerSortRank(source: IPositronLanguageModelSource): number {
	if (source.provider.id === 'posit-ai') {
		return 0;
	}
	switch (source.provider.status) {
		case 'preview':
			return 2;
		case 'experimental':
			return 3;
		default:
			return 1;
	}
}

function compareSources(a: IPositronLanguageModelSource, b: IPositronLanguageModelSource): number {
	const rankDelta = providerSortRank(a) - providerSortRank(b);
	if (rankDelta !== 0) {
		return rankDelta;
	}
	return a.provider.displayName.localeCompare(b.provider.displayName);
}

/**
 * Groups language model sources into ordered, non-empty sections for the
 * Configure LLM Providers modal: Connected, then Needs Attention, then Model
 * Providers. Within a section, providers are ordered Posit AI first, then by
 * maturity (stable, then preview, then experimental), and alphabetically by
 * display name within the same rank. The custom-provider template is handled
 * by a separate section.
 */
export function groupProviders(sources: IPositronLanguageModelSource[]): ProviderSection[] {
	const buckets = new Map<ProviderSectionId, IPositronLanguageModelSource[]>();
	for (const source of sources) {
		if (!isDisplayable(source)) {
			continue;
		}
		const id = sectionFor(source);
		const items = buckets.get(id) ?? [];
		items.push(source);
		buckets.set(id, items);
	}

	const sections: ProviderSection[] = [];
	for (const id of SECTION_ORDER) {
		const items = buckets.get(id);
		if (items && items.length > 0) {
			sections.push({ id, items: items.sort(compareSources) });
		}
	}
	return sections;
}
