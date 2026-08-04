/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILanguageModelMessage } from '../../../../platform/positronHeadlessLanguageModel/common/engine.js';

/**
 * The headless language model service: one reusable seam any Positron feature
 * can use to stream text from a model, pick a model by intent, and degrade
 * gracefully when none is available -- entirely Positron-side, with no
 * dependency on the assistant extension or `vscode.lm`.
 *
 * The whole surface is the three members below. Provider identities, the
 * provider-priority policy, credentials, the HTTP egress, the process boundary
 * (desktop / Remote SSH / web), streaming/cancellation plumbing, and caching are
 * all implementation secrets.
 */
export interface IHeadlessLanguageModelService {
	readonly _serviceBrand: undefined;

	/**
	 * Stream a text completion.
	 *
	 * Resolves to either a text stream or a typed reason it cannot proceed;
	 * consumers branch on the result rather than catching exceptions for
	 * expected states. Never triggers a sign-in prompt.
	 *
	 * @param params The system prompt, message history, optional model selection,
	 *   and optional cancellation token.
	 */
	streamText(params: IStreamTextRequest): Promise<StreamTextResult>;

	/**
	 * The models currently available, with the grouping information a picker
	 * needs. Provider *identity* stays hidden; only a display vendor is
	 * exposed.
	 */
	getAvailableModels(): Promise<readonly IAvailableModel[]>;

	/**
	 * What each provider actually contributed, for the AI diagnostic report. Unlike
	 * {@link getAvailableModels} this reports before de-duplication and names the
	 * providers that were queried, so "my provider is signed in but none of its
	 * models show up" has a visible answer. Feature code must use
	 * `getAvailableModels`: requests select a model and the service picks the
	 * provider, so branching on the provider id would route around that.
	 *
	 * Rejects when the listing failed (catalog unavailable, engine or bridge
	 * startup error), where {@link getAvailableModels} degrades to an empty list.
	 */
	getModelListingDiagnostics(): Promise<IModelListingDiagnostics>;

	/**
	 * Fires when the available-model set changes -- for example after a sign-in
	 * or sign-out -- so a picker can stay current.
	 */
	readonly onDidChangeAvailableModels: Event<void>;
}

export const IHeadlessLanguageModelService =
	createDecorator<IHeadlessLanguageModelService>('headlessLanguageModelService');

/** A request for a streamed text completion. */
export interface IStreamTextRequest {
	/** The system prompt. The service does not own prompts; the consumer builds this. */
	readonly systemPrompt: string;
	/** The message history to send, oldest first. */
	readonly messages: readonly ILanguageModelMessage[];
	/** Which model to use; defaults to the fast/cheap tier when omitted. */
	readonly model?: ModelSelection;
	/** Optional cap on the number of tokens generated. */
	readonly maxOutputTokens?: number;
	/** Cancelling stops the stream promptly and releases resources. */
	readonly cancellationToken?: CancellationToken;
}

/** The named model tiers a consumer can ask for. */
export type ModelTier = 'fast-cheap';

/**
 * How a consumer expresses which model it wants, without referencing providers
 * or credentials: a named tier, an exact id, or preference patterns.
 */
export type ModelSelection =
	/** A named tier, resolved against the tier's configured preference patterns. */
	| { readonly tier: ModelTier }
	/** An exact model id, e.g. one a user pinned from a picker. */
	| { readonly id: string }
	/** Preference patterns (e.g. `haiku`, `mini`), tried in order until one matches. */
	| { readonly patterns: readonly string[] };

/** The default fast/cheap tier, used when no preference is given. */
export const FastCheap: ModelSelection = { tier: 'fast-cheap' };

/**
 * Map a consumer's stored model setting (an ordered list of preference patterns)
 * to a {@link ModelSelection}: empty/unset means the default fast/cheap tier;
 * anything else is ordered preference patterns. A picker-written exact model id
 * still resolves precisely -- pattern matching prefers exact-id matches -- and if
 * it is gone the service falls back to the top-priority model and reports
 * `usedFallback`.
 */
export function intentFromSetting(value: readonly string[] | undefined): ModelSelection {
	if (!value || value.length === 0) {
		return FastCheap;
	}
	return { patterns: value };
}

/** The result of {@link IHeadlessLanguageModelService.streamText}. */
export type StreamTextResult =
	| {
		readonly available: true;
		/** The model that was resolved for this request. */
		readonly model: IResolvedModel;
		/**
		 * True when a tier/pattern selection matched nothing and the
		 * top-priority model was used instead. Always false for an exact
		 * `{ id }` selection. Lets a consumer surface "used a different model
		 * than configured" without re-deriving the selection.
		 */
		readonly usedFallback: boolean;
		/** The response text, streamed incrementally. Throws if the stream fails mid-flight. */
		readonly text: AsyncIterable<string>;
	}
	| {
		readonly available: false;
		/** The typed reason the request cannot proceed. */
		readonly reason: UnavailableReason;
	};

/**
 * The defined, typed reasons a request cannot proceed.
 *
 * - `no-providers-configured`: nothing in this environment can serve a model.
 * - `sign-in-required`: a provider could work, but no session exists. The
 *   actionable hint case -- the consumer can surface "sign in to enable ...".
 * - `no-model-matched`: signed in, but the requested intent matched no available model.
 * - `temporarily-unavailable`: a transient backend failure -- the request could
 *   not be set up but may succeed on retry. Internal/logged, not user-facing.
 */
export type UnavailableReason =
	| 'no-providers-configured'
	| 'sign-in-required'
	| 'no-model-matched'
	| 'temporarily-unavailable';

/** The model resolved for a request. */
export interface IResolvedModel {
	/** The exact model id (suitable for pinning via an `{ id }` {@link ModelSelection}). */
	readonly id: string;
	/** A human-readable display name. */
	readonly name: string;
}

/** An available model, as surfaced for a picker. */
export interface IAvailableModel {
	/** The exact model id (what a picker pins, via an `{ id }` {@link ModelSelection}). */
	readonly id: string;
	/** A human-readable display name. */
	readonly name: string;
	/**
	 * The vendor the model is branded under (e.g. "Anthropic", "OpenAI"), for
	 * grouping in a picker. This is what the provider reports, so it describes the
	 * model, not who served it: an OpenAI-compatible gateway will report "OpenAI"
	 * for a Google model.
	 */
	readonly vendor: string;
}

/**
 * An available model plus the provider serving it, for the AI diagnostic report.
 * Kept off {@link IAvailableModel} so feature code can't reach the provider id
 * and start routing by it; only diagnostics, which reports rather than decides,
 * gets to see it.
 */
export interface IModelWithProvider extends IAvailableModel {
	/** The provider that returned this model (e.g. "positai", "copilot"). */
	readonly providerId: string;
}

/** What the AI diagnostic report needs to explain a provider's contribution. */
export interface IModelListingDiagnostics {
	/**
	 * Providers actually queried, whether or not they returned anything. A
	 * provider missing here was skipped before the call: disabled in the catalog,
	 * its auth backend unregistered, or no credentials resolved.
	 */
	readonly queriedProviders: readonly string[];
	/**
	 * Every model returned, before de-duplication. Pre-dedupe because a provider
	 * whose models a higher-priority provider also offers contributes nothing to
	 * the deduped set, which reads identically to it having returned nothing.
	 */
	readonly models: readonly IModelWithProvider[];
}
