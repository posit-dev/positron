/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareBy, numberComparator } from '../../../../base/common/arrays.js';
import { hasKey } from '../../../../base/common/types.js';
import { IModelDescriptor } from '../../../../platform/positronHeadlessLanguageModel/common/engine.js';
import { ModelSelection, ModelTier } from './headlessLanguageModelService.js';

/**
 * The fixed provider-priority policy: Posit's own gateway first, then
 * direct-to-vendor APIs, then aggregators / compatibility endpoints. Lower is
 * preferred.
 */
function providerTier(providerId: string): number {
	switch (providerId) {
		case 'positai':
			return 0; // Posit's own gateway -- the first-party path.
		case 'anthropic':
		case 'openai':
		case 'gemini':
		case 'bedrock':
		case 'google-vertex':
		case 'deepseek':
		case 'snowflake-cortex':
		case 'ms-foundry':
			return 1; // direct-to-vendor
		default:
			return 2; // aggregators / compatibility / local (openrouter, openai-compatible, copilot, ollama, lmstudio)
	}
}

/**
 * Order models by the priority policy. `sort` is spec-stable, so the order a
 * provider listed its models in is preserved within a tier.
 */
export function byPriority(models: readonly IModelDescriptor[]): IModelDescriptor[] {
	return models.slice().sort(compareBy(model => providerTier(model.providerId), numberComparator));
}

/**
 * A {@link ModelSelection} with any tier already resolved to its configured
 * preference patterns -- the only forms the selector handles.
 */
export type ResolvedModelSelection = Exclude<ModelSelection, { readonly tier: ModelTier }>;

/** One model to try, in preference order, with how it was chosen. */
export interface IModelCandidate {
	/** The model to attempt. */
	readonly model: IModelDescriptor;
	/**
	 * True when this candidate is a priority fallback the selection did not ask
	 * for (its patterns matched nothing, or every match was tried first). Always
	 * false for an exact `{ id }` selection and for pattern matches themselves.
	 */
	readonly usedFallback: boolean;
}

/**
 * Resolve a model selection against the available models into an ordered list
 * of candidates to try, applying the provider-priority policy.
 *
 * An exact id returns precisely that model (one candidate) or none if it is
 * gone -- a pinned model must not silently become a different one. A pattern or
 * tier selection returns every match first (in preference order), then the
 * remaining models by priority as last-resort fallbacks, so a stalling preferred
 * model can be bypassed and a background feature still lands a working model if
 * any exists.
 */
export function selectModelCandidates(
	available: readonly IModelDescriptor[],
	selection: ResolvedModelSelection,
): IModelCandidate[] {
	const ordered = byPriority(available);
	if (hasKey(selection, { id: true })) {
		const exact = ordered.find(model => model.id === selection.id);
		return exact ? [{ model: exact, usedFallback: false }] : []; // exact: no fallback
	}
	const matched = matchPatterns(ordered, selection.patterns);
	const matchedIds = new Set(matched.map(model => model.id));
	const fallback = ordered.filter(model => !matchedIds.has(model.id));
	return [
		...matched.map(model => ({ model, usedFallback: false })),
		...fallback.map(model => ({ model, usedFallback: true })),
	];
}

/**
 * Collect every model matching the patterns, in preference order: patterns
 * tried in order, and within a pattern an exact id match wins over substring
 * matches (so a pinned id passed as a pattern resolves first). Matching is
 * case-insensitive across the model id and display name; each model appears at
 * most once.
 */
function matchPatterns(ordered: readonly IModelDescriptor[], patterns: readonly string[]): IModelDescriptor[] {
	const result: IModelDescriptor[] = [];
	const seen = new Set<string>();
	const take = (model: IModelDescriptor) => {
		if (!seen.has(model.id)) {
			seen.add(model.id);
			result.push(model);
		}
	};
	for (const pattern of patterns) {
		const needle = pattern.toLowerCase();
		ordered.filter(model => model.id.toLowerCase() === needle).forEach(take);
		ordered.filter(model =>
			model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle)).forEach(take);
	}
	return result;
}
