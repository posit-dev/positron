/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronLanguageModelSource } from './interfaces/positronAssistantService.js';

/** Section identifiers, in fixed display order. */
export type ProviderSectionId = 'needs-attention' | 'connected' | 'custom' | 'approved' | 'available';

/** A non-empty group of providers to render under one heading. */
export interface ProviderSection {
	id: ProviderSectionId;
	items: IPositronLanguageModelSource[];
}

const SECTION_ORDER: ProviderSectionId[] = ['needs-attention', 'connected', 'custom', 'approved', 'available'];

/** Only chat providers (and the copilot-auth completion provider) are shown, mirroring the legacy modal. */
function isDisplayable(source: IPositronLanguageModelSource): boolean {
	return source.type === 'chat' || (source.type === 'completion' && source.provider.id === 'copilot-auth');
}

/** Which section a source belongs to, based on sign-in and connection status. */
function sectionFor(source: IPositronLanguageModelSource): ProviderSectionId {
	if (source.signedIn && source.status === 'error') {
		return 'needs-attention';
	}
	if (source.signedIn) {
		return 'connected';
	}
	return 'available';
}

/** Sort rank within a section: Posit AI first, then stable, preview, experimental. */
function sortRank(source: IPositronLanguageModelSource): number {
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
	const rankDiff = sortRank(a) - sortRank(b);
	if (rankDiff !== 0) {
		return rankDiff;
	}
	return a.provider.displayName.localeCompare(b.provider.displayName);
}

/**
 * Groups language model sources into ordered, non-empty sections for the
 * Configure LLM Providers modal. Custom and Approved sections have no backing
 * data yet and will simply be absent until sources land in those buckets.
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
