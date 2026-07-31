/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { isDefined } from '../../../../base/common/types.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import {
	Definition,
	DefinitionProvider,
	DocumentHighlight,
	DocumentHighlightProvider,
	Hover,
	HoverProvider,
	Location,
	LocationLink,
	ReferenceContext,
	ReferenceProvider,
	SignatureHelpContext,
	SignatureHelpProvider,
	SignatureHelpResult,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { toCellPosition, toDocumentRange } from '../common/quartoPositionMapping.js';
import { guardAgainstShadowCellUriLeaks } from '../common/quartoShadowUriLeakGuard.js';
import { invokeSafely, QuartoShadowCellRequest, QuartoShadowLanguageBridge } from './quartoShadowLanguageBridge.js';

/**
 * The simple bridge providers for Quarto (`.qmd`) documents: each forwards a
 * request inside a code cell to the providers registered for the cell's
 * shadow text model (position translated to cell coordinates) and translates
 * results back to document coordinates. Requests in prose or on fence lines
 * return `undefined`, leaving them to the Quarto extension.
 *
 * Completions and code actions live in their own files
 * (quartoShadowCompletionProvider.ts, quartoShadowCodeActionProvider.ts);
 * they carry resolve round-trips that need per-item bookkeeping.
 */

/** Bridged hover: merges the hovers of all cell providers into one. */
export class QuartoShadowHoverProvider implements HoverProvider {

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideHover(model: ITextModel, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const request = this._bridge.resolveRequest(model, position.lineNumber);
		if (!request) {
			return undefined;
		}
		const { cell, cellModel } = request;
		const cellPosition = toCellPosition(cell, position);

		const providers = this._languageFeaturesService.hoverProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		const hovers = (await Promise.all(providers.map(provider => invokeSafely(
			() => provider.provideHover(cellModel, cellPosition, token), this._logService))))
			.filter(isDefined)
			.filter(hover => hover.contents.length > 0);
		if (token.isCancellationRequested || hovers.length === 0) {
			return undefined;
		}

		// The bridge occupies a single provider slot on the .qmd model, so the
		// cell providers' hovers are merged into one (contents concatenated in
		// provider score order). Verbosity is not forwarded: a verbosity
		// request round-trips the previous hover in provider space, and the
		// merged hover is not any single provider's.
		const hover: Hover = { contents: hovers.flatMap(h => h.contents) };
		const rangeSource = hovers.find(h => h.range);
		if (rangeSource?.range) {
			hover.range = toDocumentRange(cell, rangeSource.range);
		}
		return guardAgainstShadowCellUriLeaks('hover', hover, this._logService);
	}
}

/** Bridged signature help: the first cell provider with a result wins. */
export class QuartoShadowSignatureHelpProvider implements SignatureHelpProvider {

	// Static superset across cell languages (Python, R, Julia all trigger on
	// '(' and retrigger on ','); a per-request dynamic set is not possible
	// because a .qmd model hosts cells of several languages at once.
	readonly signatureHelpTriggerCharacters = ['(', ','];
	readonly signatureHelpRetriggerCharacters = [')'];

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideSignatureHelp(
		model: ITextModel,
		position: Position,
		token: CancellationToken,
		context: SignatureHelpContext,
	): Promise<SignatureHelpResult | undefined> {
		const request = this._bridge.resolveRequest(model, position.lineNumber);
		if (!request) {
			return undefined;
		}
		const { cell, cellModel } = request;
		const cellPosition = toCellPosition(cell, position);

		// First result wins, in provider score order - the same semantics the
		// parameter hints widget applies across providers of one model.
		const providers = this._languageFeaturesService.signatureHelpProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		for (const provider of providers) {
			const result = await invokeSafely(
				() => provider.provideSignatureHelp(cellModel, cellPosition, token, context), this._logService);
			if (token.isCancellationRequested) {
				result?.dispose();
				return undefined;
			}
			if (result) {
				// Signature help carries no positions or URIs to translate;
				// the guard is a pure backstop.
				const guarded = guardAgainstShadowCellUriLeaks('signature help', result, this._logService);
				if (!guarded) {
					result.dispose();
				}
				return guarded;
			}
		}
		return undefined;
	}
}

/** Shared location translation for definitions and references. */
function mapLocationsToDocument(
	bridge: QuartoShadowLanguageBridge,
	request: QuartoShadowCellRequest,
	items: readonly (Location | LocationLink)[],
): LocationLink[] {
	const mapped: LocationLink[] = [];
	for (const item of items) {
		// Shadow cell targets (this document's cells, or another open .qmd's)
		// are rewritten to their document URI; real files pass through;
		// unmappable shadow cells are dropped.
		const location = bridge.mapLocationToDocument(item.uri, item.range);
		if (!location) {
			continue;
		}
		const link: LocationLink = { uri: location.uri, range: location.range };
		// Locations lack the LocationLink selection ranges; read them as
		// optional fields of the union's wider member.
		const { originSelectionRange, targetSelectionRange } = item as LocationLink;
		if (originSelectionRange) {
			// The origin is in the request cell's space.
			link.originSelectionRange = toDocumentRange(request.cell, originSelectionRange);
		}
		if (targetSelectionRange) {
			// The target selection is in the target's space.
			link.targetSelectionRange = bridge.mapLocationToDocument(item.uri, targetSelectionRange)?.range;
		}
		mapped.push(link);
	}
	return mapped;
}

/** Bridged go-to-definition: results from all cell providers, flattened. */
export class QuartoShadowDefinitionProvider implements DefinitionProvider {

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideDefinition(model: ITextModel, position: Position, token: CancellationToken): Promise<Definition | undefined> {
		const request = this._bridge.resolveRequest(model, position.lineNumber);
		if (!request) {
			return undefined;
		}
		const cellPosition = toCellPosition(request.cell, position);

		const providers = this._languageFeaturesService.definitionProvider.ordered(request.cellModel)
			.filter(provider => provider !== this);
		const results = (await Promise.all(providers.map(provider => invokeSafely(
			() => provider.provideDefinition(request.cellModel, cellPosition, token), this._logService))))
			.filter(isDefined);
		if (token.isCancellationRequested || results.length === 0) {
			return undefined;
		}

		const links = mapLocationsToDocument(this._bridge, request,
			results.flatMap(result => Array.isArray(result) ? result : [result]));
		return guardAgainstShadowCellUriLeaks('definition', links, this._logService);
	}
}

/** Bridged find-references: results from all cell providers, flattened. */
export class QuartoShadowReferenceProvider implements ReferenceProvider {

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideReferences(
		model: ITextModel,
		position: Position,
		context: ReferenceContext,
		token: CancellationToken,
	): Promise<Location[] | undefined> {
		const request = this._bridge.resolveRequest(model, position.lineNumber);
		if (!request) {
			return undefined;
		}
		const cellPosition = toCellPosition(request.cell, position);

		const providers = this._languageFeaturesService.referenceProvider.ordered(request.cellModel)
			.filter(provider => provider !== this);
		const results = (await Promise.all(providers.map(provider => invokeSafely(
			() => provider.provideReferences(request.cellModel, cellPosition, context, token), this._logService))))
			.filter(isDefined);
		if (token.isCancellationRequested || results.length === 0) {
			return undefined;
		}

		const locations = mapLocationsToDocument(this._bridge, request, results.flat());
		return guardAgainstShadowCellUriLeaks('references', locations, this._logService);
	}
}

/** Bridged document highlights: the first cell provider with results wins. */
export class QuartoShadowDocumentHighlightProvider implements DocumentHighlightProvider {

	constructor(
		private readonly _bridge: QuartoShadowLanguageBridge,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async provideDocumentHighlights(model: ITextModel, position: Position, token: CancellationToken): Promise<DocumentHighlight[] | undefined> {
		const request = this._bridge.resolveRequest(model, position.lineNumber);
		if (!request) {
			return undefined;
		}
		const { cell, cellModel } = request;
		const cellPosition = toCellPosition(cell, position);

		// First non-empty result wins, matching the word-highlighter's
		// first-provider semantics. Highlights are ranges within the request
		// cell only; occurrences in the document's other cells are out of
		// scope (they would need the multi-document highlight registry).
		const providers = this._languageFeaturesService.documentHighlightProvider.ordered(cellModel)
			.filter(provider => provider !== this);
		for (const provider of providers) {
			const highlights = await invokeSafely(
				() => provider.provideDocumentHighlights(cellModel, cellPosition, token), this._logService);
			if (token.isCancellationRequested) {
				return undefined;
			}
			if (highlights && highlights.length > 0) {
				const mapped = highlights.map(highlight => ({
					...highlight,
					range: toDocumentRange(cell, highlight.range),
				}));
				return guardAgainstShadowCellUriLeaks('document highlights', mapped, this._logService);
			}
		}
		return undefined;
	}
}
