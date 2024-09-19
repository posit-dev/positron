/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import type { Parser } from '@vscode/tree-sitter-wasm';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { AppResourcePath, FileAccess } from 'vs/base/common/network';
import { FontStyle, MetadataConsts } from 'vs/editor/common/encodedTokenAttributes';
import { ITreeSitterTokenizationSupport, LazyTokenizationSupport, TreeSitterTokenizationRegistry } from 'vs/editor/common/languages';
import { ITextModel } from 'vs/editor/common/model';
import { EDITOR_EXPERIMENTAL_PREFER_TREESITTER, ITreeSitterParserService, ITreeSitterParseResult } from 'vs/editor/common/services/treeSitterParserService';
import { IModelTokensChangedEvent } from 'vs/editor/common/textModelEvents';
import { ColumnRange } from 'vs/editor/contrib/inlineCompletions/browser/utils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TokenStyle } from 'vs/platform/theme/common/tokenClassificationRegistry';
import { ColorThemeData } from 'vs/workbench/services/themes/common/colorThemeData';

const ALLOWED_SUPPORT = ['typescript'];
type TreeSitterQueries = string;

export const ITreeSitterTokenizationFeature = createDecorator<ITreeSitterTokenizationFeature>('treeSitterTokenizationFeature');

export interface ITreeSitterTokenizationFeature {
	_serviceBrand: undefined;
}

class TreeSitterTokenizationFeature extends Disposable implements ITreeSitterTokenizationFeature {
	public _serviceBrand: undefined;
	private readonly _tokenizersRegistrations: DisposableMap<string, DisposableStore> = new DisposableMap();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IFileService private readonly _fileService: IFileService
	) {
		super();

		this._handleGrammarsExtPoint();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(EDITOR_EXPERIMENTAL_PREFER_TREESITTER)) {
				this._handleGrammarsExtPoint();
			}
		}));
	}

	private _getSetting(): string[] {
		return this._configurationService.getValue<string[]>(EDITOR_EXPERIMENTAL_PREFER_TREESITTER) || [];
	}

	private _handleGrammarsExtPoint(): void {
		const setting = this._getSetting();

		// Eventually, this should actually use an extension point to add tree sitter grammars, but for now they are hard coded in core
		for (const languageId of setting) {
			if (ALLOWED_SUPPORT.includes(languageId) && !this._tokenizersRegistrations.has(languageId)) {
				const lazyTokenizationSupport = new LazyTokenizationSupport(() => this._createTokenizationSupport(languageId));
				const disposableStore = new DisposableStore();
				disposableStore.add(lazyTokenizationSupport);
				disposableStore.add(TreeSitterTokenizationRegistry.registerFactory(languageId, lazyTokenizationSupport));
				this._tokenizersRegistrations.set(languageId, disposableStore);
				TreeSitterTokenizationRegistry.getOrCreate(languageId);
			}
		}
	}

	private async _fetchQueries(newLanguage: string): Promise<TreeSitterQueries> {
		const languageLocation: AppResourcePath = `vs/editor/common/languages/highlights/${newLanguage}.scm`;
		const query = await this._fileService.readFile(FileAccess.asFileUri(languageLocation));
		return query.value.toString();
	}

	private async _createTokenizationSupport(languageId: string): Promise<ITreeSitterTokenizationSupport & IDisposable | null> {
		const queries = await this._fetchQueries(languageId);
		return this._instantiationService.createInstance(TreeSitterTokenizationSupport, queries, languageId);
	}
}

class TreeSitterTokenizationSupport extends Disposable implements ITreeSitterTokenizationSupport {
	private _query: Parser.Query | undefined;
	private readonly _onDidChangeTokens: Emitter<IModelTokensChangedEvent> = new Emitter();
	public readonly onDidChangeTokens: Event<IModelTokensChangedEvent> = this._onDidChangeTokens.event;
	private _colorThemeData!: ColorThemeData;
	private _languageAddedListener: IDisposable | undefined;

	constructor(
		private readonly _queries: TreeSitterQueries,
		private readonly _languageId: string,
		@ITreeSitterParserService private readonly _treeSitterService: ITreeSitterParserService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super();
		this._register(Event.runAndSubscribe(this._themeService.onDidColorThemeChange, () => this.reset()));
	}

	private _getTree(textModel: ITextModel): ITreeSitterParseResult | undefined {
		return this._treeSitterService.getParseResult(textModel);
	}

	private _ensureQuery() {
		if (!this._query) {
			const language = this._treeSitterService.getOrInitLanguage(this._languageId);
			if (!language) {
				if (!this._languageAddedListener) {
					this._languageAddedListener = this._register(Event.onceIf(this._treeSitterService.onDidAddLanguage, e => e.id === this._languageId)((e) => {
						this._query = e.language.query(this._queries);
					}));
				}
				return;
			}
			this._query = language.query(this._queries);
		}
		return this._query;
	}

	private reset() {
		this._colorThemeData = this._themeService.getColorTheme() as ColorThemeData;
	}

	captureAtPosition(lineNumber: number, column: number, textModel: ITextModel): any {
		const captures = this._captureAtRange(lineNumber, new ColumnRange(column, column), textModel);
		return captures;
	}

	private _captureAtRange(lineNumber: number, columnRange: ColumnRange, textModel: ITextModel): Parser.QueryCapture[] {
		const tree = this._getTree(textModel);
		const query = this._ensureQuery();
		if (!tree?.tree || !query) {
			return [];
		}
		// Tree sitter row is 0 based, column is 0 based
		return query.captures(tree.tree.rootNode, { startPosition: { row: lineNumber - 1, column: columnRange.startColumn - 1 }, endPosition: { row: lineNumber - 1, column: columnRange.endColumnExclusive } });
	}

	/**
	 * Gets the tokens for a given line.
	 * Each token takes 2 elements in the array. The first element is the offset of the end of the token *in the line, not in the document*, and the second element is the metadata.
	 *
	 * @param lineNumber
	 * @returns
	 */
	public tokenizeEncoded(lineNumber: number, textModel: ITextModel): Uint32Array | undefined {
		const lineLength = textModel.getLineMaxColumn(lineNumber);
		const captures = this._captureAtRange(lineNumber, new ColumnRange(1, lineLength), textModel);

		if (captures.length === 0) {
			return undefined;
		}

		let tokens: Uint32Array = new Uint32Array(captures.length * 2);
		let tokenIndex = 0;
		const lineStartOffset = textModel.getOffsetAt({ lineNumber: lineNumber, column: 1 });

		for (let captureIndex = 0; captureIndex < captures.length; captureIndex++) {
			const capture = captures[captureIndex];
			const metadata = this.findMetadata(capture.name);
			const tokenEndIndex = capture.node.endIndex < lineStartOffset + lineLength ? capture.node.endIndex : lineStartOffset + lineLength;
			const tokenStartIndex = capture.node.startIndex < lineStartOffset ? lineStartOffset : capture.node.startIndex;

			const lineRelativeOffset = tokenEndIndex - lineStartOffset;
			// Not every character will get captured, so we need to make sure that our current capture doesn't bleed toward the start of the line and cover characters that it doesn't apply to.
			// We do this by creating a new token in the array if the previous token ends before the current token starts.
			let previousTokenEnd: number;
			const currentTokenLength = tokenEndIndex - tokenStartIndex;
			if (captureIndex > 0) {
				previousTokenEnd = tokens[(tokenIndex - 1) * 2];
			} else {
				previousTokenEnd = tokenStartIndex - lineStartOffset - 1;
			}
			const intermediateTokenOffset = lineRelativeOffset - currentTokenLength;
			if (previousTokenEnd < intermediateTokenOffset) {
				tokens[tokenIndex * 2] = intermediateTokenOffset;
				tokens[tokenIndex * 2 + 1] = 0;
				tokenIndex++;
				const newTokens = new Uint32Array(tokens.length + 2);
				newTokens.set(tokens);
				tokens = newTokens;
			}

			tokens[tokenIndex * 2] = lineRelativeOffset;
			tokens[tokenIndex * 2 + 1] = metadata;
			tokenIndex++;
		}

		if (captures[captures.length - 1].node.endPosition.column + 1 < lineLength) {
			const newTokens = new Uint32Array(tokens.length + 2);
			newTokens.set(tokens);
			tokens = newTokens;
			tokens[tokenIndex * 2] = lineLength;
			tokens[tokenIndex * 2 + 1] = 0;
		}
		return tokens;
	}

	private findMetadata(captureName: string): number {
		const tokenStyle: TokenStyle | undefined = this._colorThemeData.resolveScopes([[captureName]]);
		if (!tokenStyle) {
			return 0;
		}

		let metadata = 0;
		if (typeof tokenStyle.italic !== 'undefined') {
			const italicBit = (tokenStyle.italic ? FontStyle.Italic : 0);
			metadata |= italicBit | MetadataConsts.ITALIC_MASK;
		}
		if (typeof tokenStyle.bold !== 'undefined') {
			const boldBit = (tokenStyle.bold ? FontStyle.Bold : 0);
			metadata |= boldBit | MetadataConsts.BOLD_MASK;
		}
		if (typeof tokenStyle.underline !== 'undefined') {
			const underlineBit = (tokenStyle.underline ? FontStyle.Underline : 0);
			metadata |= underlineBit | MetadataConsts.UNDERLINE_MASK;
		}
		if (typeof tokenStyle.strikethrough !== 'undefined') {
			const strikethroughBit = (tokenStyle.strikethrough ? FontStyle.Strikethrough : 0);
			metadata |= strikethroughBit | MetadataConsts.STRIKETHROUGH_MASK;
		}
		if (tokenStyle.foreground) {
			const tokenStyleForeground = this._colorThemeData.getTokenColorIndex().get(tokenStyle?.foreground);
			const foregroundBits = tokenStyleForeground << MetadataConsts.FOREGROUND_OFFSET;
			metadata |= foregroundBits;
		}

		return metadata;
	}

	override dispose() {
		super.dispose();
		this._query?.delete();
		this._query = undefined;
	}
}

registerSingleton(ITreeSitterTokenizationFeature, TreeSitterTokenizationFeature, InstantiationType.Eager);

