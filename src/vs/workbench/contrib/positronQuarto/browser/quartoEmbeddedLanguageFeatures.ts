/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { onUnexpectedExternalError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { assertType } from '../../../../base/common/types.js';
import { Constants } from '../../../../base/common/uint.js';
import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import { LanguageFeatureRegistry } from '../../../../editor/common/languageFeatureRegistry.js';
import {
	CompletionContext,
	CompletionItem,
	CompletionItemProvider,
	CompletionList,
	Definition,
	DefinitionProvider,
	DocumentSymbol,
	DocumentSymbolProvider,
	HelpTopicProvider,
	Hover,
	HoverProvider,
	IStatementRange,
	Location,
	LocationLink,
	SignatureHelpContext,
	SignatureHelpProvider,
	SignatureHelpResult,
	StatementRangeKind,
	StatementRangeProvider,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService, LogLevel } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import {
	QUARTO_LANGUAGE_IDS,
	QUARTO_NATIVE_LANGUAGE_FEATURES_KEY,
	usingNativeEmbeddedFeatures,
} from '../common/positronQuartoConfig.js';
import {
	cellRangeToSource,
	cellZeroBasedLineToSource,
	ICellLineSpan,
	sourcePositionToCell,
} from '../common/quartoCellPositionMapping.js';
import { IQuartoVirtualNotebookService } from './quartoVirtualNotebookService.js';

/**
 * Documents that can hold embedded code cells. Taken from the shared list so
 * this cannot drift from what the rest of the contribution treats as Quarto.
 */
const QUARTO_SELECTOR: LanguageSelector = QUARTO_LANGUAGE_IDS.map(language => ({ language }));

/** A provider that declares the characters it wants to be woken for. */
interface ITriggerCharacterProvider {
	readonly triggerCharacters?: readonly string[];
}

/**
 * A position in a Quarto document, resolved to the cell that holds it.
 *
 * The line span is copied rather than referenced. Syncing a document can rebuild
 * its cells while a request is still in flight, and a request that started before
 * the rebuild has to finish in the coordinates it started with.
 */
interface IResolvedCell {
	readonly textModel: ITextModel;
	readonly cellUri: URI;
	readonly span: ICellLineSpan;
	readonly position: Position;
}

/**
 * Remap a completion item's range, which is either a plain range or an
 * insert/replace pair, from cell coordinates back to source coordinates.
 */
function mapCompletionItemRange(cell: ICellLineSpan, range: CompletionItem['range']): CompletionItem['range'] {
	const pair = range as { insert?: IRange; replace?: IRange };
	if (pair.insert && pair.replace) {
		return {
			insert: cellRangeToSource(cell, pair.insert),
			replace: cellRangeToSource(cell, pair.replace),
		};
	}
	return cellRangeToSource(cell, range as IRange);
}

/**
 * Remap every part of a completion item that carries coordinates.
 *
 * `additionalTextEdits` matters as much as `range` does. It is how a server adds
 * an import at the top of the file when you accept a symbol, so leaving it in
 * cell coordinates writes that import into whatever happens to be at the same
 * line of the Quarto document, which is usually the frontmatter.
 *
 * `command.arguments` is opaque, so a command that carries positions cannot be
 * corrected here. No server we forward to is known to do that.
 */
function mapCompletionItem(cell: ICellLineSpan, item: CompletionItem): CompletionItem {
	return {
		...item,
		range: mapCompletionItemRange(cell, item.range),
		additionalTextEdits: item.additionalTextEdits?.map(edit => ({
			...edit,
			range: cellRangeToSource(cell, edit.range),
		})),
	};
}

/** Where a cell lives, for turning a definition inside it into a source location. */
interface ICellLocation {
	readonly sourceUri: URI;
	readonly span: ICellLineSpan;
}

/**
 * Remap one definition result.
 *
 * A definition can land in any cell, not only the one the request came from. A
 * server that indexes every open document will happily point at a symbol defined
 * in an earlier chunk, and returning that verbatim hands the editor a hidden cell
 * URI that it cannot open. Entries in a real file are already in the coordinates
 * their own document uses and pass through untouched.
 *
 * `originSelectionRange` is always rewritten against the requesting cell. It
 * describes where the request came from, which we translated before forwarding.
 */
function mapDefinitionEntry(
	requestSpan: ICellLineSpan,
	locate: (uri: URI) => ICellLocation | undefined,
	entry: Location | LocationLink
): Location | LocationLink {
	const link = entry as LocationLink;
	const mapped: LocationLink = { ...link };

	if (link.originSelectionRange) {
		mapped.originSelectionRange = cellRangeToSource(requestSpan, link.originSelectionRange);
	}

	const target = locate(entry.uri);
	if (target) {
		mapped.uri = target.sourceUri;
		mapped.range = cellRangeToSource(target.span, entry.range);
		if (link.targetSelectionRange) {
			mapped.targetSelectionRange = cellRangeToSource(target.span, link.targetSelectionRange);
		}
	}
	return mapped;
}

/**
 * Remap a symbol, and everything nested under it, into source coordinates.
 *
 * A child symbol carries ranges of its own rather than offsets within its
 * parent, so a tree corrected only at the root puts every function body and
 * every nested binding at the wrong line of the document.
 */
function mapDocumentSymbol(cell: ICellLineSpan, symbol: DocumentSymbol): DocumentSymbol {
	return {
		...symbol,
		range: cellRangeToSource(cell, symbol.range),
		selectionRange: cellRangeToSource(cell, symbol.selectionRange),
		children: symbol.children?.map(child => mapDocumentSymbol(cell, child)),
	};
}

/**
 * The source range of a cell's code, fences excluded.
 *
 * Built from the line span rather than from the cell's text model, because a
 * sync can dispose that model while a request is out and the only consumer
 * matches on lines. `MAX_SAFE_SMALL_INTEGER` is the codebase's way of saying
 * "to the end of the line".
 *
 * An empty chunk produces `codeStartLine > codeEndLine`, which would build an
 * inverted range here, but that case cannot arrive: an empty cell has no
 * symbols, and a cell with no symbols is omitted before its range is ever built.
 */
function cellSourceRange(span: ICellLineSpan): IRange {
	return {
		startLineNumber: span.codeStartLine,
		startColumn: 1,
		endLineNumber: span.codeEndLine,
		endColumn: Constants.MAX_SAFE_SMALL_INTEGER,
	};
}

/**
 * Remap a statement range result into source coordinates.
 *
 * The two outcomes carry their coordinates differently. A success carries a
 * range, which is what gets executed, so leaving it in cell coordinates runs
 * whatever sits at that line of the Quarto document instead. A rejection
 * carries the line of the syntax error on its own, zero indexed.
 */
function mapStatementRange(cell: ICellLineSpan, result: IStatementRange): IStatementRange {
	if (result.kind === StatementRangeKind.Success) {
		return { ...result, range: cellRangeToSource(cell, result.range) };
	}
	return result.line === undefined
		? result
		: { ...result, line: cellZeroBasedLineToSource(cell, result.line) };
}

/**
 * The providers to ask about a cell, in order, with our own filtered out.
 *
 * See `QuartoEmbeddedProvider._downstream` for why callers take the first
 * usable answer rather than merging every provider's.
 */
function downstreamProviders<T>(registry: LanguageFeatureRegistry<T>, textModel: ITextModel): T[] {
	return registry.ordered(textModel)
		.filter(provider => !(provider instanceof QuartoEmbeddedProvider));
}

/**
 * Shared behaviour for the providers that serve a Quarto document by asking the
 * providers registered on its hidden notebook cells.
 */
abstract class QuartoEmbeddedProvider {
	constructor(
		protected readonly _virtualNotebooks: IQuartoVirtualNotebookService,
		protected readonly _languageFeatures: ILanguageFeaturesService,
		protected readonly _logService: ILogService,
	) { }

	/**
	 * Record that a request was answered from a cell rather than by the Quarto
	 * extension's virtual documents.
	 *
	 * The two paths run side by side until the extension stops answering, and they
	 * produce results a user cannot tell apart: Positron deduplicates completion
	 * items, so even the overlap is invisible. Without this line there is no way to
	 * confirm the feature is doing anything, which makes it untestable by hand and
	 * unsupportable in the field.
	 *
	 * Guarded rather than left to the log level, because this runs on every
	 * keystroke that opens the suggest widget and the message would be built even
	 * when nothing reads it.
	 */
	protected _traceForwarded(feature: string, span: ICellLineSpan, providers: readonly unknown[]): void {
		if (this._tracing) {
			this._logService.trace(`[QuartoEmbedded] ${feature} answered from cell ` +
				`${span.codeStartLine}-${span.codeEndLine} by ${providers.length} provider(s)`);
		}
	}

	/** Whether anybody is reading the trace, so a message is worth building. */
	protected get _tracing(): boolean {
		return this._logService.getLevel() === LogLevel.Trace;
	}

	/**
	 * Find the cell holding a position in a Quarto document, with the position
	 * translated into that cell's coordinates.
	 *
	 * Returns `undefined` for prose, frontmatter, and the fence lines, which the
	 * Quarto extension's own language server answers.
	 */
	protected _resolve(model: ITextModel, position: Position): IResolvedCell | undefined {
		// Synchronize first. A pending sync can rebuild the cells and dispose the
		// models they hold, so a cell read beforehand may already be stale.
		this._virtualNotebooks.ensureSynchronized(model.uri);

		const cell = this._virtualNotebooks.getCellAtLine(model.uri, position.lineNumber);
		if (!cell) {
			return undefined;
		}
		// Unreachable while the service is consistent, since `getCellAtLine` uses
		// the same bounds this does. Handled because the return type says it can
		// be undefined, not as a guard against anything we can produce.
		const cellPosition = sourcePositionToCell(cell, position);
		if (!cellPosition) {
			return undefined;
		}
		return {
			textModel: cell.textModel,
			cellUri: cell.cellUri,
			span: { codeStartLine: cell.codeStartLine, codeEndLine: cell.codeEndLine },
			position: Position.lift(cellPosition),
		};
	}

	/** Find the Quarto document and cell span behind a cell URI, if it is ours. */
	protected _locateCell(uri: URI): ICellLocation | undefined {
		const sourceUri = this._virtualNotebooks.getSourceUriForCell(uri);
		if (!sourceUri) {
			return undefined;
		}
		const cell = this._virtualNotebooks.getCells(sourceUri)
			.find(candidate => candidate.cellUri.toString() === uri.toString());
		return cell
			? { sourceUri, span: { codeStartLine: cell.codeStartLine, codeEndLine: cell.codeEndLine } }
			: undefined;
	}

	/**
	 * The providers to ask about a cell, in order.
	 *
	 * Callers take the first usable answer rather than merging every provider's,
	 * because Positron runs more than one language server per language. Pyrefly
	 * registers alongside the Python server, for instance, so merging produces
	 * two of everything. That is what posit-dev/positron#13907 looks like in the
	 * Outline, and asking every server also doubles the work per request, which
	 * runs against the slowness this routing exists to fix.
	 */
	protected _downstream<T>(registry: LanguageFeatureRegistry<T>, textModel: ITextModel): T[] {
		return downstreamProviders(registry, textModel);
	}

	/**
	 * The characters the servers behind the open cells want to be woken for.
	 *
	 * The suggest widget reads trigger characters from the providers registered
	 * on the document being edited, which for a Quarto document is this provider
	 * alone. The servers that answer are registered on the cells, which no editor
	 * shows, so their own characters never reach the widget on their own.
	 *
	 * Collecting them here rather than listing them by hand means a language we
	 * have never heard of works as soon as its extension registers a provider,
	 * and that a server changing its mind needs no change from us. Extensions
	 * already hand these to Positron: `$registerCompletionsProvider` puts them
	 * straight onto the provider (`mainThreadLanguageFeatures.ts`).
	 *
	 * This is read when the suggest widget rebuilds its map, on editor, language,
	 * configuration, and provider registry changes, rather than per keystroke.
	 */
	protected _collectTriggerCharacters<T extends ITriggerCharacterProvider>(
		registry: LanguageFeatureRegistry<T>
	): string[] {
		const characters = new Set<string>();
		for (const cell of this._virtualNotebooks.getAllCells()) {
			for (const provider of this._downstream(registry, cell.textModel)) {
				for (const character of provider.triggerCharacters ?? []) {
					characters.add(character);
				}
			}
		}
		return Array.from(characters);
	}
}

/**
 * Serves completions inside Quarto code cells.
 */
interface ICompletionOrigin {
	readonly provider: CompletionItemProvider;
	readonly item: CompletionItem;
	readonly span: ICellLineSpan;
}

class QuartoEmbeddedCompletionProvider extends QuartoEmbeddedProvider implements CompletionItemProvider {
	readonly _debugDisplayName = 'quartoEmbeddedCompletions';

	/**
	 * Where each item we handed out came from, so that resolving it can go back to
	 * the same provider with the same item. Weak, so entries go away with the items
	 * the suggest widget drops.
	 */
	private readonly _origins = new WeakMap<CompletionItem, ICompletionOrigin>();

	get triggerCharacters(): string[] {
		return this._collectTriggerCharacters(this._languageFeatures.completionProvider);
	}

	async provideCompletionItems(
		model: ITextModel,
		position: Position,
		context: CompletionContext,
		token: CancellationToken
	): Promise<CompletionList | undefined> {
		const resolved = this._resolve(model, position);
		if (!resolved) {
			return undefined;
		}
		const { textModel, span, position: cellPosition } = resolved;

		const downstream = this._downstream(this._languageFeatures.completionProvider, textModel);
		this._traceForwarded('completion', span, downstream);

		for (const provider of downstream) {
			const result = await provider.provideCompletionItems(textModel, cellPosition, context, token);
			if (!result) {
				continue;
			}
			if (result.suggestions.length === 0) {
				result.dispose?.();
				continue;
			}
			return {
				suggestions: result.suggestions.map(item => {
					const mapped = mapCompletionItem(span, item);
					this._origins.set(mapped, { provider, item, span });
					return mapped;
				}),
				incomplete: result.incomplete,
				dispose: () => result.dispose?.(),
			};
		}
		return undefined;
	}

	/**
	 * Forward resolution to whichever provider produced the item.
	 *
	 * Without this the suggest widget skips resolution altogether, because it looks
	 * for the method on the provider it called, which is this one. That costs the
	 * documentation panel, and it costs any edit a server only computes on resolve,
	 * which is the usual way an auto-import arrives.
	 */
	async resolveCompletionItem(item: CompletionItem, token: CancellationToken): Promise<CompletionItem> {
		const origin = this._origins.get(item);
		if (!origin?.provider.resolveCompletionItem) {
			return item;
		}
		const resolved = await origin.provider.resolveCompletionItem(origin.item, token);
		// Resolution answers in the cell's coordinates, as the original did, and
		// carries the same fields that have to move back to the source document.
		return resolved ? mapCompletionItem(origin.span, resolved) : item;
	}
}

/**
 * Serves hovers inside Quarto code cells.
 */
class QuartoEmbeddedHoverProvider extends QuartoEmbeddedProvider implements HoverProvider {
	async provideHover(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<Hover | undefined> {
		const resolved = this._resolve(model, position);
		if (!resolved) {
			return undefined;
		}
		const { textModel, span, position: cellPosition } = resolved;

		const downstream = this._downstream(this._languageFeatures.hoverProvider, textModel);
		this._traceForwarded('hover', span, downstream);

		for (const provider of downstream) {
			const result = await provider.provideHover(textModel, cellPosition, token);
			if (result) {
				return result.range ? { ...result, range: cellRangeToSource(span, result.range) } : result;
			}
		}
		return undefined;
	}
}

/**
 * Serves signature help inside Quarto code cells. Results carry no ranges, so
 * they pass through untouched.
 */
class QuartoEmbeddedSignatureHelpProvider extends QuartoEmbeddedProvider implements SignatureHelpProvider {
	get signatureHelpTriggerCharacters(): string[] {
		return this._collectSignatureCharacters(provider => provider.signatureHelpTriggerCharacters);
	}

	/**
	 * Retrigger characters are collected as well as trigger characters. The hint
	 * widget reads them separately, and without them a hint never advances to the
	 * next parameter as you type past a comma.
	 */
	get signatureHelpRetriggerCharacters(): string[] {
		return this._collectSignatureCharacters(provider => provider.signatureHelpRetriggerCharacters);
	}

	private _collectSignatureCharacters(
		select: (provider: SignatureHelpProvider) => readonly string[] | undefined
	): string[] {
		const characters = new Set<string>();
		for (const cell of this._virtualNotebooks.getAllCells()) {
			for (const provider of this._downstream(this._languageFeatures.signatureHelpProvider, cell.textModel)) {
				for (const character of select(provider) ?? []) {
					characters.add(character);
				}
			}
		}
		return Array.from(characters);
	}

	async provideSignatureHelp(
		model: ITextModel,
		position: Position,
		token: CancellationToken,
		context: SignatureHelpContext
	): Promise<SignatureHelpResult | undefined> {
		const resolved = this._resolve(model, position);
		if (!resolved) {
			return undefined;
		}
		const { textModel, position: cellPosition } = resolved;

		for (const provider of this._downstream(this._languageFeatures.signatureHelpProvider, textModel)) {
			const result = await provider.provideSignatureHelp(textModel, cellPosition, token, context);
			if (result) {
				return result;
			}
		}
		return undefined;
	}
}

/**
 * Serves go to definition inside Quarto code cells.
 */
class QuartoEmbeddedDefinitionProvider extends QuartoEmbeddedProvider implements DefinitionProvider {
	async provideDefinition(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<Definition | LocationLink[] | undefined> {
		const resolved = this._resolve(model, position);
		if (!resolved) {
			return undefined;
		}
		const { textModel, span, position: cellPosition } = resolved;

		const downstream = this._downstream(this._languageFeatures.definitionProvider, textModel);
		this._traceForwarded('definition', span, downstream);

		for (const provider of downstream) {
			const result = await provider.provideDefinition(textModel, cellPosition, token);
			if (!result) {
				continue;
			}
			const entries = Array.isArray(result) ? result : [result];
			if (entries.length === 0) {
				continue;
			}
			return entries.map(entry =>
				mapDefinitionEntry(span, uri => this._locateCell(uri), entry)) as LocationLink[];
		}
		return undefined;
	}
}

/** The first usable answer for one cell, already in source coordinates. */
async function symbolsForCell(
	languageFeatures: ILanguageFeaturesService,
	textModel: ITextModel,
	span: ICellLineSpan,
	token: CancellationToken
): Promise<DocumentSymbol[] | undefined> {
	// A rebuild disposes the models it replaced, so a model read before the
	// requests went out can be gone by the time this runs.
	if (textModel.isDisposed()) {
		return undefined;
	}
	for (const provider of downstreamProviders(languageFeatures.documentSymbolProvider, textModel)) {
		try {
			const result = await provider.provideDocumentSymbols(textModel, token);
			if (result && result.length > 0) {
				return result.map(symbol => mapDocumentSymbol(span, symbol));
			}
		} catch (error) {
			// One provider failing must not discard the other cells' symbols, so
			// report it and move on to the next provider for this cell.
			onUnexpectedExternalError(error);
		}
	}
	return undefined;
}

/** One cell's symbols, and where that cell's code sits in the source document. */
export interface IQuartoCellSymbols {
	readonly range: IRange;
	readonly symbols: DocumentSymbol[];
}

/**
 * The symbols of every code cell in a Quarto document, grouped by the cell they
 * came from and already in source coordinates.
 *
 * Two consumers: the Outline provider below, which flattens this, and the
 * `_executeQuartoCellSymbolProvider` command, which hands the grouping to the
 * Quarto extension so it can nest each cell's symbols under that chunk in the
 * tree it already builds. Grouped rather than flat because only the extension
 * knows which heading a chunk sits under.
 *
 * A cell with nothing to report is omitted rather than returned empty, and an
 * unknown document answers with an empty array rather than undefined, so a
 * caller has one shape to handle.
 */
export async function provideQuartoCellSymbols(
	virtualNotebooks: IQuartoVirtualNotebookService,
	languageFeatures: ILanguageFeaturesService,
	logService: ILogService,
	uri: URI,
	token: CancellationToken
): Promise<IQuartoCellSymbols[]> {
	// Notebook creation is asynchronous so a request that arrives during
	// creation would see no cells at all.
	await virtualNotebooks.whenReady(uri);

	virtualNotebooks.ensureSynchronized(uri);

	// Snapshot before the requests go out, since a sync rebuilds the cells. The
	// spans are a copy, not a guarantee: an edit that leaves the chunk structure
	// alone updates them in place, and the next pass corrects what this missed.
	const cells = virtualNotebooks.getCells(uri).map(cell => ({
		textModel: cell.textModel,
		span: { codeStartLine: cell.codeStartLine, codeEndLine: cell.codeEndLine },
	}));

	if (token.isCancellationRequested) {
		return [];
	}

	// Ask every cell at once. Cells are independent and each request is a round
	// trip to a language server, so asking them one at a time makes the walk
	// cost the sum of those trips instead of the longest one. On the 45 chunks
	// of posit-dev/positron#14512 that was the difference between 5049 ms and
	// 63 ms.
	const perCell = await Promise.all(cells.map(
		({ textModel, span }) => symbolsForCell(languageFeatures, textModel, span, token)));

	// Cancelling cannot un-ask a request that already went out. What it must do
	// is keep a superseded pass from reaching the Outline.
	if (token.isCancellationRequested) {
		return [];
	}

	const grouped: IQuartoCellSymbols[] = [];
	for (let index = 0; index < cells.length; index++) {
		const symbols = perCell[index];
		if (symbols) {
			grouped.push({ range: cellSourceRange(cells[index].span), symbols });
		}
	}

	if (logService.getLevel() === LogLevel.Trace) {
		logService.trace('[QuartoEmbedded] document symbols answered from ' +
			`${grouped.length} of ${cells.length} cell(s)`);
	}

	return grouped;
}

/**
 * Serves the Outline for a Quarto document from its code cells. Asked about the
 * whole document rather than a position, so it walks every cell.
 *
 * Replaces the mechanism behind posit-dev/positron#14512, which writes a
 * temporary file per cell and, on any cell coming back undefined, sleeps half a
 * second and redoes the whole set. These cells are already open models, so there
 * is no retry and nothing to wait for.
 *
 * This produces a second, flat Outline group alongside the Quarto extension's
 * own nested one, so expect every code symbol twice until this provider's
 * registration is removed. The extension gets the nested contents it builds its
 * own tree from through `_executeQuartoCellSymbolProvider` instead, not from
 * this provider.
 */
class QuartoEmbeddedDocumentSymbolProvider extends QuartoEmbeddedProvider implements DocumentSymbolProvider {
	/** Names this group in the Outline. */
	readonly displayName = localize('positron.quarto.outlineProvider', "Quarto Code Cells");

	async provideDocumentSymbols(model: ITextModel, token: CancellationToken): Promise<DocumentSymbol[] | undefined> {
		const grouped = await provideQuartoCellSymbols(
			this._virtualNotebooks, this._languageFeatures, this._logService, model.uri, token);
		const symbols = grouped.flatMap(entry => entry.symbols);

		// An empty list would still build a group in the Outline, which is noise
		// beside the Quarto server's headings. It is also what a cancelled
		// request produces, which must not replace the results it superseded.
		return symbols.length > 0 ? symbols : undefined;
	}
}

/**
 * Serves statement ranges inside Quarto code cells, which is what Cmd+Enter
 * runs when the cursor is in a chunk.
 */
class QuartoEmbeddedStatementRangeProvider extends QuartoEmbeddedProvider implements StatementRangeProvider {
	async provideStatementRange(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<IStatementRange | undefined> {
		const resolved = this._resolve(model, position);
		if (!resolved) {
			return undefined;
		}
		const { textModel, span, position: cellPosition } = resolved;

		const downstream = this._downstream(this._languageFeatures.statementRangeProvider, textModel);
		this._traceForwarded('statement range', span, downstream);

		for (const provider of downstream) {
			const result = await provider.provideStatementRange(textModel, cellPosition, token);
			if (result) {
				return mapStatementRange(span, result);
			}
		}
		return undefined;
	}
}

/**
 * Serves help topics inside Quarto code cells, which is what F1 asks for.
 * A topic is a plain string, so nothing needs remapping.
 */
class QuartoEmbeddedHelpTopicProvider extends QuartoEmbeddedProvider implements HelpTopicProvider {
	async provideHelpTopic(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<string | undefined> {
		const resolved = this._resolve(model, position);
		if (!resolved) {
			return undefined;
		}
		const { textModel, span, position: cellPosition } = resolved;

		const downstream = this._downstream(this._languageFeatures.helpTopicProvider, textModel);
		this._traceForwarded('help topic', span, downstream);

		for (const provider of downstream) {
			const result = await provider.provideHelpTopic(textModel, cellPosition, token);
			// An empty topic is not a topic. Returning it opens Help on nothing
			// rather than letting the next provider answer.
			if (result) {
				return result;
			}
		}
		return undefined;
	}
}

/**
 * Registers the providers that serve language features for code cells embedded
 * in Quarto documents, so that requests are answered in process instead of
 * through the Quarto extension's temporary virtual documents.
 */
export class QuartoEmbeddedLanguageFeatures extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronQuartoEmbeddedLanguageFeatures';

	private readonly _registrations = this._register(new DisposableStore());

	constructor(
		@IQuartoVirtualNotebookService private readonly _virtualNotebooks: IQuartoVirtualNotebookService,
		@ILanguageFeaturesService private readonly _languageFeatures: ILanguageFeaturesService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._updateRegistrations();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY)) {
				this._updateRegistrations();
			}
		}));
	}

	private _updateRegistrations(): void {
		this._registrations.clear();
		if (!usingNativeEmbeddedFeatures(this._configurationService)) {
			return;
		}

		const args = [this._virtualNotebooks, this._languageFeatures, this._logService] as const;
		this._registrations.add(this._languageFeatures.completionProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedCompletionProvider(...args)));
		this._registrations.add(this._languageFeatures.hoverProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedHoverProvider(...args)));
		this._registrations.add(this._languageFeatures.signatureHelpProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedSignatureHelpProvider(...args)));
		this._registrations.add(this._languageFeatures.definitionProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedDefinitionProvider(...args)));
		this._registrations.add(this._languageFeatures.documentSymbolProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedDocumentSymbolProvider(...args)));
		this._registrations.add(this._languageFeatures.statementRangeProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedStatementRangeProvider(...args)));
		this._registrations.add(this._languageFeatures.helpTopicProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedHelpTopicProvider(...args)));
	}
}

/**
 * Answers the symbols of a Quarto document's code cells, grouped by cell.
 *
 * Exposed to extensions as `positron.executeQuartoCellSymbolProvider`, which is
 * how the Quarto extension gets code symbols without building a temporary file
 * per cell. It nests them into the Outline tree itself, under the chunk each one
 * came from, which is why the answer is grouped rather than flat.
 *
 * Registered unconditionally, unlike the providers above. It needs no setting
 * gate: virtual notebooks only exist while `quarto.embeddedLanguageFeatures.native`
 * is on, so with the setting off there are no cells and the answer is empty.
 */
CommandsRegistry.registerCommand('_executeQuartoCellSymbolProvider', async (accessor, ...args: [URI]) => {
	const [uri] = args;
	assertType(URI.isUri(uri));

	return await provideQuartoCellSymbols(
		accessor.get(IQuartoVirtualNotebookService),
		accessor.get(ILanguageFeaturesService),
		accessor.get(ILogService),
		uri,
		CancellationToken.None
	);
});
