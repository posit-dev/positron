/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError, onUnexpectedExternalError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import {
	DocumentRangeSemanticTokensProvider,
	DocumentSemanticTokensProvider,
	SemanticTokens,
	SemanticTokensLegend,
} from '../../../../editor/common/languages.js';
import { LanguageFeatureRegistry } from '../../../../editor/common/languageFeatureRegistry.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { isSemanticTokens } from '../../../../editor/contrib/semanticTokens/common/getSemanticTokens.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ICellLineSpan } from '../common/quartoCellPositionMapping.js';
import {
	decodeSemanticTokens,
	encodeCellSemanticTokens,
	FIELDS_PER_TOKEN,
	ICellSemanticTokens,
	IDecodedToken,
	UnionSemanticTokensLegend,
} from '../common/quartoSemanticTokens.js';
import {
	QUARTO_NATIVE_LANGUAGE_FEATURES_KEY,
	usingNativeEmbeddedFeatures,
} from '../common/positronQuartoConfig.js';
import { QUARTO_SELECTOR, QuartoEmbeddedProvider } from './quartoEmbeddedLanguageFeatures.js';
import { IQuartoVirtualNotebookService } from './quartoVirtualNotebookService.js';

/**
 * Serves semantic tokens for a Quarto document from its code cells, so that
 * highlighting inside a chunk comes from the language server that owns the
 * chunk's language.
 *
 * Asked about the whole document rather than a position, so it walks every cell
 * and returns one stream covering all of them. Lines the stream says nothing
 * about keep the colours the grammar gave them, which is how a partial answer
 * layers over prose, fences, and the languages that have no server to ask.
 */
class QuartoEmbeddedSemanticTokensProvider extends QuartoEmbeddedProvider implements DocumentSemanticTokensProvider, IDisposable {
	private readonly _store = new DisposableStore();
	private readonly _onDidChange = this._store.add(new Emitter<void>());
	private readonly _downstreamListeners = this._store.add(new DisposableStore());

	/**
	 * Passes a language server's "my tokens changed" on to the Quarto document.
	 *
	 * Without this, a server that finishes indexing and asks for a refresh, which
	 * is what Pyrefly does on a cold project, cannot reach the document at all.
	 * `ModelSemanticColoring.handleProviderDidChange` ignores any provider
	 * outside `registry.all(quartoModel)`, and a Python or R provider scores zero
	 * against a Quarto model, so the only route is for the provider that is in
	 * that set to speak for them. The alternative is colours that stay stale
	 * until the user happens to type.
	 */
	readonly onDidChange = this._onDidChange.event;

	/**
	 * Fixed for the life of this provider, and the reason the contribution below
	 * replaces the provider instead of updating it.
	 *
	 * `SemanticTokensStylingService` caches a provider's legend in a `WeakMap`
	 * keyed by the provider itself, and drops that cache only when the colour
	 * theme changes. A registry change re-requests tokens but keeps the cached
	 * legend, so a provider that changed its own legend would hand back indices
	 * read against a legend the editor no longer has. Holding the legend still
	 * and swapping the whole provider keeps the two in step by construction.
	 */
	private readonly _union: UnionSemanticTokensLegend;

	constructor(
		legends: readonly SemanticTokensLegend[],
		virtualNotebooks: IQuartoVirtualNotebookService,
		languageFeatures: ILanguageFeaturesService,
		logService: ILogService,
	) {
		super(virtualNotebooks, languageFeatures, logService);
		this._union = new UnionSemanticTokensLegend(legends);

		this._bindDownstreamListeners();
		for (const registry of this._registries()) {
			this._store.add(registry.onDidChange(() => this._bindDownstreamListeners()));
		}
	}

	dispose(): void {
		this._store.dispose();
	}

	/** The registries a cell can be answered from, in the order they are tried. */
	private _registries(): readonly LanguageFeatureRegistry<DocumentSemanticTokensProvider | DocumentRangeSemanticTokensProvider>[] {
		return [
			this._languageFeatures.documentSemanticTokensProvider,
			this._languageFeatures.documentRangeSemanticTokensProvider,
		];
	}

	/**
	 * Subscribe to every downstream provider's own change event, rebinding when
	 * the set of them changes. Modelled on core's `bindProviderChangeListeners`,
	 * which does the same for the providers it holds.
	 *
	 * Subscribed to the whole registry, but forwarded only for the providers that
	 * answer for a cell open right now; see `_servesAnOpenCell`.
	 */
	private _bindDownstreamListeners(): void {
		this._downstreamListeners.clear();
		for (const registry of this._registries()) {
			for (const provider of registry.allNoModel()) {
				// Our own event is what this fans in to, so subscribing to it
				// would be a loop.
				if (provider instanceof QuartoEmbeddedProvider || !provider.onDidChange) {
					continue;
				}
				this._downstreamListeners.add(provider.onDidChange(() => {
					if (this._servesAnOpenCell(provider)) {
						this._onDidChange.fire();
					}
				}));
			}
		}
	}

	/**
	 * Whether a provider answers for any cell of any open Quarto document.
	 *
	 * Firing our event re-tokenizes every open Quarto document, so a server for a
	 * language that appears in no chunk must not reach it. Most of the registry
	 * is exactly that: every language installed, whether or not a chunk uses it.
	 *
	 * Asked when the event arrives rather than when the subscription is made,
	 * because the set of open cells changes with no event to rebind on. A
	 * subscription list built from cells would miss the server for a language
	 * whose first chunk is written later, and missing a refresh is the stale
	 * colouring this forwarding exists to prevent. Evaluating here cannot go
	 * stale, and costs a scored walk only on a downstream change.
	 */
	private _servesAnOpenCell(provider: DocumentSemanticTokensProvider | DocumentRangeSemanticTokensProvider): boolean {
		for (const cell of this._virtualNotebooks.getAllCells()) {
			// A cell's model can be disposed by a rebuild between the event and
			// this walk, and scoring a disposed model throws.
			if (cell.textModel.isDisposed()) {
				continue;
			}
			for (const registry of this._registries()) {
				if (this._downstream(registry, cell.textModel).includes(provider)) {
					return true;
				}
			}
		}
		return false;
	}

	getLegend(): SemanticTokensLegend {
		return this._union.legend;
	}

	async provideDocumentSemanticTokens(
		model: ITextModel,
		lastResultId: string | null,
		token: CancellationToken
	): Promise<SemanticTokens | null> {
		try {
			return await this._provide(model, token);
		} catch (error) {
			// Cancellation is the one thing worth throwing. The editor treats it
			// as "ask again later" and keeps the colours already on the model,
			// where the null below would clear them.
			if (isCancellationError(error)) {
				throw error;
			}
			// `getDocumentSemanticTokens` inspects every provider's error before
			// it looks at any provider's tokens, and rethrows the first one it
			// finds. Letting anything else escape here would therefore not just
			// lose this answer, it would discard the Quarto extension's good
			// answer alongside it and leave the document with no semantic
			// highlighting at all.
			onUnexpectedExternalError(error);
			return null;
		}
	}

	private async _provide(model: ITextModel, token: CancellationToken): Promise<SemanticTokens | null> {
		// Notebook creation is asynchronous, so a request arriving during
		// creation would otherwise see a document with no cells.
		await this._virtualNotebooks.whenReady(model.uri);
		this._virtualNotebooks.ensureSynchronized(model.uri);

		// Snapshot before the requests go out, since a sync rebuilds the cells
		// and disposes the models they held.
		const cells = this._virtualNotebooks.getCells(model.uri).map(cell => ({
			textModel: cell.textModel,
			span: { codeStartLine: cell.codeStartLine, codeEndLine: cell.codeEndLine },
		}));

		if (cells.length === 0) {
			return null;
		}
		throwIfCancelled(token);

		// Ask every cell at once. Each request is a round trip to a language
		// server and the cells are independent, so a serial walk would cost the
		// sum of those trips rather than the longest one. On the 45 chunks of
		// posit-dev/positron#14512 that distinction was 5049 ms against 63 ms.
		const perCell = await Promise.all(cells.map(cell => this._tokensForCell(cell.span, cell.textModel, token)));

		// Cancelling cannot un-ask a request already in flight. What it has to do
		// is keep a superseded pass from replacing newer colours, which means
		// throwing rather than answering null: the editor reads a null answer as
		// "this provider has no tokens" and clears the ones already on the model,
		// where a cancellation error leaves them alone and reschedules.
		throwIfCancelled(token);

		const answered = perCell.filter((cell): cell is ICellSemanticTokens => cell !== undefined);

		// Encode before deciding whether there is anything to say. Tokens are
		// still dropped at this step, by the out-of-cell guard, so a count taken
		// from the cells above can be non-zero while the stream comes out empty.
		//
		// No `resultId`, so the editor asks for a whole document every time and
		// never for a delta. Deltas against a cell layout that shifts on every
		// edit above a chunk would be a lot of bookkeeping for a saving nobody
		// has measured a need for.
		const data = encodeCellSemanticTokens(answered);

		// Nothing to contribute. Said as null rather than as an empty stream,
		// because the editor takes the first provider that returns any tokens at
		// all and an empty answer of ours would count, which until the Quarto
		// extension's own path is switched off would suppress it.
		if (data.length === 0) {
			return null;
		}

		this._logService.trace(`[QuartoEmbedded] semantic tokens answered from ` +
			`${answered.length} of ${cells.length} cell(s) with ` +
			`${data.length / FIELDS_PER_TOKEN} token(s)`);

		return { data };
	}

	/**
	 * The first usable answer for one cell, with its indices translated into the
	 * union legend but its positions still cell-relative.
	 *
	 * Takes the first provider that answers rather than merging every provider's
	 * tokens: Positron runs more than one server for a language, Pyrefly
	 * alongside the Python server being the case that exists today, and merging
	 * would colour the same text twice from two disagreeing opinions.
	 */
	private async _tokensForCell(
		span: ICellLineSpan,
		textModel: ITextModel,
		token: CancellationToken
	): Promise<ICellSemanticTokens | undefined> {
		// A rebuild disposes the models it replaced, so a model read before the
		// requests went out can already be gone by the time this runs.
		if (textModel.isDisposed()) {
			return undefined;
		}

		const fromDocumentProvider = await this._askDocumentProviders(span, textModel, token);
		if (fromDocumentProvider) {
			return fromDocumentProvider;
		}
		return await this._askRangeProviders(span, textModel, token);
	}

	/** Ask the providers that answer for a whole document. */
	private async _askDocumentProviders(
		span: ICellLineSpan,
		textModel: ITextModel,
		token: CancellationToken
	): Promise<ICellSemanticTokens | undefined> {
		for (const provider of this._downstream(this._languageFeatures.documentSemanticTokensProvider, textModel)) {
			try {
				const result = await provider.provideDocumentSemanticTokens(textModel, null, token);

				// Release whatever came back, before deciding whether it is any
				// use. A server may hold state for a result it expects a delta
				// request against, and we never send one, so a result skipped
				// below without being released is one it keeps for good. Requests
				// re-run on every edit, so that set would only grow.
				if (result?.resultId !== undefined) {
					provider.releaseDocumentSemanticTokens(result.resultId);
				}

				if (!result) {
					continue;
				}

				// Deltas are only meaningful against a `resultId` we asked to be
				// told about, and we never pass one, so an edits response is a
				// server ignoring that. Nothing sensible to apply it to here, so
				// treat it as no answer and try the next provider.
				if (!isSemanticTokens(result)) {
					continue;
				}

				// An empty answer still counts as an answer, and stops the walk.
				// A comment-only chunk genuinely has no tokens, and asking the
				// next server for a second opinion is the merging this provider
				// exists to avoid.
				return { span, tokens: this._remap(result.data, provider.getLegend()) };
			} catch (error) {
				// A cancelled request has to surface as a cancellation rather
				// than as this cell having nothing, for the reason in `_provide`.
				if (isCancellationError(error)) {
					throw error;
				}
				// One cell's server failing must not cost the other cells their
				// colours, so report it and try the next provider for this cell.
				onUnexpectedExternalError(error);
			}
		}

		return undefined;
	}

	/**
	 * Ask the providers that answer only for a range, over the whole cell.
	 *
	 * Some languages register nothing else. TypeScript and JavaScript are the
	 * ones a Quarto document is likely to hold, through `{ojs}` and `{js}`
	 * chunks, and `typescript-language-features` registers a range provider
	 * alone. Core makes the same fallback when a document has no document
	 * provider, and so does `_provideDocumentSemanticTokens`, which is the
	 * command the Quarto extension's virtual document path goes through. Without
	 * this those chunks would lose the tokens they have today.
	 *
	 * A range provider's stream is encoded against the model, exactly as a
	 * document provider's is, so nothing about the mapping changes.
	 */
	private async _askRangeProviders(
		span: ICellLineSpan,
		textModel: ITextModel,
		token: CancellationToken
	): Promise<ICellSemanticTokens | undefined> {
		for (const provider of this._downstream(this._languageFeatures.documentRangeSemanticTokensProvider, textModel)) {
			try {
				const result = await provider.provideDocumentRangeSemanticTokens(
					textModel, textModel.getFullModelRange(), token);
				if (!result) {
					continue;
				}
				return { span, tokens: this._remap(result.data, provider.getLegend()) };
			} catch (error) {
				if (isCancellationError(error)) {
					throw error;
				}
				onUnexpectedExternalError(error);
			}
		}

		return undefined;
	}

	/** Translate a wire-format stream into union-legend indices, dropping what will not fit. */
	private _remap(data: Uint32Array, sourceLegend: SemanticTokensLegend): IDecodedToken[] {
		const tokens: IDecodedToken[] = [];
		for (const decoded of decodeSemanticTokens(data)) {
			const remapped = this._union.remap(decoded, sourceLegend);
			if (remapped) {
				tokens.push(remapped);
			}
		}
		return tokens;
	}

	releaseDocumentSemanticTokens(_resultId: string | undefined): void {
		// Nothing to release: no result ids are issued, so the editor has no
		// result of ours to ask us to forget.
	}
}

/**
 * Stop, as a cancellation rather than as an empty answer.
 *
 * `ModelSemanticColoring` clears the model's semantic tokens when a provider
 * answers null, and leaves them in place when the request rejects with a
 * cancellation. Answering null for a superseded pass would therefore wipe the
 * colours the pass that superseded it just set.
 */
function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
}

/**
 * The legends of every registered semantic tokens provider except our own.
 *
 * Read from the whole registry rather than from the providers on the open cells,
 * because opening a document does not change the registry and so gives no signal
 * to rebuild a legend with. A legend collected from open cells would miss a
 * language whose first document opens later, and the editor would still be
 * holding the older legend. The registry changes only when a provider comes or
 * goes, which is exactly when this answer changes.
 *
 * The cost of the wider net is some unused names, from providers whose languages
 * never appear in a Quarto chunk. Names are what themes resolve, so carrying a
 * few extra costs nothing.
 */
function downstreamLegends(languageFeatures: ILanguageFeaturesService, logService: ILogService): SemanticTokensLegend[] {
	const legends: SemanticTokensLegend[] = [];
	// Both registries, because a cell may be answered from either and the legend
	// has to be able to express whichever answers.
	const registries = [
		languageFeatures.documentSemanticTokensProvider,
		languageFeatures.documentRangeSemanticTokensProvider,
	];
	for (const registry of registries) {
		for (const provider of registry.allNoModel()) {
			if (provider instanceof QuartoEmbeddedProvider) {
				continue;
			}
			try {
				legends.push(provider.getLegend());
			} catch (error) {
				// Reaching an extension host can fail. A legend we cannot read
				// only costs that provider's names, so keep the ones we can read.
				logService.warn(`[QuartoEmbedded] could not read a semantic tokens legend: ${error}`);
			}
		}
	}
	return legends;
}

/** Whether two legends name the same things in the same order. */
function sameLegend(a: SemanticTokensLegend, b: SemanticTokensLegend): boolean {
	return a.tokenTypes.length === b.tokenTypes.length
		&& a.tokenModifiers.length === b.tokenModifiers.length
		&& a.tokenTypes.every((name, index) => name === b.tokenTypes[index])
		&& a.tokenModifiers.every((name, index) => name === b.tokenModifiers[index]);
}

/**
 * Registers the provider that serves semantic tokens for Quarto documents, and
 * replaces it whenever the token names available to it change.
 *
 * Replacing rather than updating is deliberate; see the note on the provider's
 * `_union`. A new provider is also a registry change in its own right, which is
 * what prompts the editor to read the new legend and ask for tokens again, so
 * the two halves of the refresh come from the same act.
 */
export class QuartoEmbeddedSemanticTokens extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronQuartoEmbeddedSemanticTokens';

	private readonly _registration = this._register(new MutableDisposable());

	/** The legend the registered provider is answering with, if any. */
	private _legend: SemanticTokensLegend | undefined;

	/** Guards against the re-entry our own registration would otherwise cause. */
	private _updating = false;

	constructor(
		@IQuartoVirtualNotebookService private readonly _virtualNotebooks: IQuartoVirtualNotebookService,
		@ILanguageFeaturesService private readonly _languageFeatures: ILanguageFeaturesService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._update();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY)) {
				this._update();
			}
		}));

		// A server arriving or leaving is the only thing that changes which
		// token names exist, and it is also how the cold start heals: nothing
		// has registered when this contribution is created, so the first legend
		// is empty and the first server to register replaces it. Both registries,
		// since a cell can be answered from either.
		this._register(this._languageFeatures.documentSemanticTokensProvider.onDidChange(() => this._update()));
		this._register(this._languageFeatures.documentRangeSemanticTokensProvider.onDidChange(() => this._update()));
	}

	private _update(): void {
		// Registering fires the registry change this also listens to, so without
		// this guard the first update would re-enter itself partway through.
		if (this._updating) {
			return;
		}
		this._updating = true;
		try {
			this._updateRegistration();
		} finally {
			this._updating = false;
		}
	}

	private _updateRegistration(): void {
		if (!usingNativeEmbeddedFeatures(this._configurationService)) {
			this._registration.clear();
			this._legend = undefined;
			return;
		}

		const legends = downstreamLegends(this._languageFeatures, this._logService);
		const union = new UnionSemanticTokensLegend(legends);

		// Nothing a Quarto document could be coloured with, so nothing worth
		// registering for. Registering anyway would put a provider in the score
		// group that always answers null, which on its own is harmless, but
		// staying out keeps the empty case from looking like a working one.
		if (union.legend.tokenTypes.length === 0) {
			this._registration.clear();
			this._legend = undefined;
			return;
		}

		// Replacing the provider re-tokenizes every open Quarto document, so
		// only do it when the names actually changed rather than on every
		// registry event.
		if (this._legend && sameLegend(this._legend, union.legend)) {
			return;
		}

		this._legend = union.legend;

		// The provider holds subscriptions to the downstream providers it speaks
		// for, so replacing it has to dispose it as well as unregister it.
		// Assigning here disposes whatever was in place before.
		const store = new DisposableStore();
		const provider = store.add(new QuartoEmbeddedSemanticTokensProvider(
			legends, this._virtualNotebooks, this._languageFeatures, this._logService));
		store.add(this._languageFeatures.documentSemanticTokensProvider.register(QUARTO_SELECTOR, provider));
		this._registration.value = store;

		this._logService.trace('[QuartoEmbedded] semantic tokens legend now covers ' +
			`${union.legend.tokenTypes.length} type(s) and ` +
			`${union.legend.tokenModifiers.length} modifier(s)`);
	}
}

