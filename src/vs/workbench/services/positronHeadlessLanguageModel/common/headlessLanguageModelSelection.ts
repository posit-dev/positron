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

/**
 * Resolve a model selection against the available models, applying the
 * provider-priority policy.
 *
 * An exact id returns precisely that model, or `undefined` if it is gone -- a
 * pinned model must not silently become a different one. A pattern selection,
 * being best-effort, falls back to the highest-priority available model when
 * nothing matches, so a background feature always lands a model if any exists.
 */
export interface IModelSelectionResult {
	/** The chosen model, or `undefined` when nothing is available. */
	readonly model: IModelDescriptor | undefined;
	/**
	 * True when a tier/pattern selection matched nothing and fell back to the
	 * top-priority model. Always false for an exact `{ id }` selection.
	 */
	readonly usedFallback: boolean;
}

export function selectModel(
	available: readonly IModelDescriptor[],
	selection: ResolvedModelSelection,
): IModelSelectionResult {
	const ordered = byPriority(available);
	if (hasKey(selection, { id: true })) {
		return { model: ordered.find(model => model.id === selection.id), usedFallback: false }; // exact: no fallback
	}
	const matched = matchPatterns(ordered, selection.patterns);
	if (matched) {
		return { model: matched, usedFallback: false };
	}
	return { model: ordered[0], usedFallback: ordered.length > 0 }; // patterns: fall back to top-priority
}

/**
 * Try each pattern in order until one matches an available model. For a
 * given pattern an exact id match wins over a substring match, so a pinned id
 * passed as a pattern resolves precisely. Matching is case-insensitive across
 * the model id and display name.
 */
function matchPatterns(ordered: readonly IModelDescriptor[], patterns: readonly string[]): IModelDescriptor | undefined {
	for (const pattern of patterns) {
		const needle = pattern.toLowerCase();
		const exact = ordered.find(model => model.id.toLowerCase() === needle);
		if (exact) {
			return exact;
		}
		const partial = ordered.find(model =>
			model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle));
		if (partial) {
			return partial;
		}
	}
	return undefined;
}
