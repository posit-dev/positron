/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
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
	Hover,
	HoverProvider,
	Location,
	LocationLink,
	SignatureHelpContext,
	SignatureHelpProvider,
	SignatureHelpResult,
} from '../../../../editor/common/languages.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import {
	QUARTO_LANGUAGE_IDS,
	QUARTO_NATIVE_LANGUAGE_FEATURES_KEY,
	usingNativeEmbeddedFeatures,
} from '../common/positronQuartoConfig.js';
import { cellRangeToSource, ICellLineSpan, sourcePositionToCell } from '../common/quartoCellPositionMapping.js';
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
 * Shared behaviour for the providers that serve a Quarto document by asking the
 * providers registered on its hidden notebook cells.
 */
abstract class QuartoEmbeddedProvider {
	constructor(
		protected readonly _virtualNotebooks: IQuartoVirtualNotebookService,
		protected readonly _languageFeatures: ILanguageFeaturesService,
	) { }

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
		return registry.ordered(textModel)
			.filter(provider => !(provider instanceof QuartoEmbeddedProvider));
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

		for (const provider of this._downstream(this._languageFeatures.completionProvider, textModel)) {
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

		for (const provider of this._downstream(this._languageFeatures.hoverProvider, textModel)) {
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

		for (const provider of this._downstream(this._languageFeatures.definitionProvider, textModel)) {
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

		const args = [this._virtualNotebooks, this._languageFeatures] as const;
		this._registrations.add(this._languageFeatures.completionProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedCompletionProvider(...args)));
		this._registrations.add(this._languageFeatures.hoverProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedHoverProvider(...args)));
		this._registrations.add(this._languageFeatures.signatureHelpProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedSignatureHelpProvider(...args)));
		this._registrations.add(this._languageFeatures.definitionProvider.register(
			QUARTO_SELECTOR, new QuartoEmbeddedDefinitionProvider(...args)));
	}
}
