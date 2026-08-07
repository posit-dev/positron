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
import { IQuartoVirtualCell, IQuartoVirtualNotebookService } from './quartoVirtualNotebookService.js';

/**
 * Documents that can hold embedded code cells. Taken from the shared list so
 * this cannot drift from what the rest of the contribution treats as Quarto.
 */
const QUARTO_SELECTOR: LanguageSelector = QUARTO_LANGUAGE_IDS.map(language => ({ language }));

/** A provider that declares the characters it wants to be woken for. */
interface ITriggerCharacterProvider {
	readonly triggerCharacters?: readonly string[];
}

/** A position in a Quarto document, resolved to the cell that holds it. */
interface IResolvedCell {
	readonly cell: IQuartoVirtualCell;
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
 * Remap one definition result. Only entries that point into the cell itself are
 * rewritten, onto the source document; a definition in another file is already
 * in the coordinates its own document uses.
 *
 * `originSelectionRange` is always rewritten. It describes where the request
 * came from, which we translated into the cell before forwarding.
 */
function mapDefinitionEntry(
	cell: IQuartoVirtualCell,
	sourceUri: URI,
	entry: Location | LocationLink
): Location | LocationLink {
	const link = entry as LocationLink;
	const mapped: LocationLink = { ...link };

	if (link.originSelectionRange) {
		mapped.originSelectionRange = cellRangeToSource(cell, link.originSelectionRange);
	}
	if (entry.uri.toString() === cell.cellUri.toString()) {
		mapped.uri = sourceUri;
		mapped.range = cellRangeToSource(cell, entry.range);
		if (link.targetSelectionRange) {
			mapped.targetSelectionRange = cellRangeToSource(cell, link.targetSelectionRange);
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
		return { cell, position: Position.lift(cellPosition) };
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
	protected _downstream<T>(registry: LanguageFeatureRegistry<T>, cell: IQuartoVirtualCell): T[] {
		return registry.ordered(cell.textModel)
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
			for (const provider of this._downstream(registry, cell)) {
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
class QuartoEmbeddedCompletionProvider extends QuartoEmbeddedProvider implements CompletionItemProvider {
	readonly _debugDisplayName = 'quartoEmbeddedCompletions';

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
		const { cell, position: cellPosition } = resolved;

		for (const provider of this._downstream(this._languageFeatures.completionProvider, cell)) {
			const result = await provider.provideCompletionItems(cell.textModel, cellPosition, context, token);
			if (!result) {
				continue;
			}
			if (result.suggestions.length === 0) {
				result.dispose?.();
				continue;
			}
			return {
				suggestions: result.suggestions.map(item => ({
					...item,
					range: mapCompletionItemRange(cell, item.range),
				})),
				incomplete: result.incomplete,
				dispose: () => result.dispose?.(),
			};
		}
		return undefined;
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
		const { cell, position: cellPosition } = resolved;

		for (const provider of this._downstream(this._languageFeatures.hoverProvider, cell)) {
			const result = await provider.provideHover(cell.textModel, cellPosition, token);
			if (result) {
				return result.range ? { ...result, range: cellRangeToSource(cell, result.range) } : result;
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
		// The registry stores these as `signatureHelpTriggerCharacters`, so they
		// need reading under that name rather than the completion one.
		const characters = new Set<string>();
		for (const cell of this._virtualNotebooks.getAllCells()) {
			for (const provider of this._downstream(this._languageFeatures.signatureHelpProvider, cell)) {
				for (const character of provider.signatureHelpTriggerCharacters ?? []) {
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
		const { cell, position: cellPosition } = resolved;

		for (const provider of this._downstream(this._languageFeatures.signatureHelpProvider, cell)) {
			const result = await provider.provideSignatureHelp(cell.textModel, cellPosition, token, context);
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
		const { cell, position: cellPosition } = resolved;

		for (const provider of this._downstream(this._languageFeatures.definitionProvider, cell)) {
			const result = await provider.provideDefinition(cell.textModel, cellPosition, token);
			if (!result) {
				continue;
			}
			const entries = Array.isArray(result) ? result : [result];
			if (entries.length === 0) {
				continue;
			}
			return entries.map(entry => mapDefinitionEntry(cell, model.uri, entry)) as LocationLink[];
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
