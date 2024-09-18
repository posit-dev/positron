/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as arrays from 'vs/base/common/arrays';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { CancelablePromise, createCancelablePromise, first, timeout } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedError, onUnexpectedExternalError } from 'vs/base/common/errors';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IActiveCodeEditor, ICodeEditor, isDiffEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, EditorContributionInstantiation, IActionOptions, registerEditorAction, registerEditorContribution, registerModelAndPositionCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { IWordAtPosition } from 'vs/editor/common/core/wordHelper';
import { CursorChangeReason, ICursorPositionChangedEvent } from 'vs/editor/common/cursorEvents';
import { IDiffEditor, IEditorContribution, IEditorDecorationsCollection } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { LanguageFeatureRegistry } from 'vs/editor/common/languageFeatureRegistry';
import { DocumentHighlight, DocumentHighlightKind, DocumentHighlightProvider, MultiDocumentHighlightProvider } from 'vs/editor/common/languages';
import { IModelDeltaDecoration, ITextModel, shouldSynchronizeModel } from 'vs/editor/common/model';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { getHighlightDecorationOptions } from 'vs/editor/contrib/wordHighlighter/browser/highlightDecorations';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { Schemas } from 'vs/base/common/network';
import { ResourceMap } from 'vs/base/common/map';
import { score } from 'vs/editor/common/languageSelector';
// import { TextualMultiDocumentHighlightFeature } from 'vs/editor/contrib/wordHighlighter/browser/textualHighlightProvider';
// import { registerEditorFeature } from 'vs/editor/common/editorFeatures';

const ctxHasWordHighlights = new RawContextKey<boolean>('hasWordHighlights', false);

export function getOccurrencesAtPosition(registry: LanguageFeatureRegistry<DocumentHighlightProvider>, model: ITextModel, position: Position, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]> | null | undefined> {
	const orderedByScore = registry.ordered(model);

	// in order of score ask the occurrences provider
	// until someone response with a good result
	// (good = none empty array)
	return first<DocumentHighlight[] | null | undefined>(orderedByScore.map(provider => () => {
		return Promise.resolve(provider.provideDocumentHighlights(model, position, token))
			.then(undefined, onUnexpectedExternalError);
	}), arrays.isNonEmptyArray).then(result => {
		if (result) {
			const map = new ResourceMap<DocumentHighlight[]>();
			map.set(model.uri, result);
			return map;
		}
		return new ResourceMap<DocumentHighlight[]>();
	});
}

export function getOccurrencesAcrossMultipleModels(registry: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, model: ITextModel, position: Position, wordSeparators: string, token: CancellationToken, otherModels: ITextModel[]): Promise<ResourceMap<DocumentHighlight[]> | null | undefined> {
	const orderedByScore = registry.ordered(model);

	// in order of score ask the occurrences provider
	// until someone response with a good result
	// (good = none empty array)
	return first<ResourceMap<DocumentHighlight[]> | null | undefined>(orderedByScore.map(provider => () => {
		const filteredModels = otherModels.filter(otherModel => {
			return shouldSynchronizeModel(otherModel);
		}).filter(otherModel => {
			return score(provider.selector, otherModel.uri, otherModel.getLanguageId(), true, undefined, undefined) > 0;
		});

		return Promise.resolve(provider.provideMultiDocumentHighlights(model, position, filteredModels, token))
			.then(undefined, onUnexpectedExternalError);
	}), (t: ResourceMap<DocumentHighlight[]> | null | undefined): t is ResourceMap<DocumentHighlight[]> => t instanceof ResourceMap && t.size > 0);
}

interface IOccurenceAtPositionRequest {
	readonly result: Promise<ResourceMap<DocumentHighlight[]>>;
	isValid(model: ITextModel, selection: Selection, decorations: IEditorDecorationsCollection): boolean;
	cancel(): void;
}

interface IWordHighlighterQuery {
	modelInfo: {
		model: ITextModel;
		selection: Selection;
	} | null;
	readonly word: IWordAtPosition | null;
}

abstract class OccurenceAtPositionRequest implements IOccurenceAtPositionRequest {

	private readonly _wordRange: Range | null;
	private _result: CancelablePromise<ResourceMap<DocumentHighlight[]>> | null;

	constructor(private readonly _model: ITextModel, private readonly _selection: Selection, private readonly _wordSeparators: string) {
		this._wordRange = this._getCurrentWordRange(_model, _selection);
		this._result = null;
	}

	get result() {
		if (!this._result) {
			this._result = createCancelablePromise(token => this._compute(this._model, this._selection, this._wordSeparators, token));
		}
		return this._result;
	}

	protected abstract _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>>;

	private _getCurrentWordRange(model: ITextModel, selection: Selection): Range | null {
		const word = model.getWordAtPosition(selection.getPosition());
		if (word) {
			return new Range(selection.startLineNumber, word.startColumn, selection.startLineNumber, word.endColumn);
		}
		return null;
	}

	public isValid(model: ITextModel, selection: Selection, decorations: IEditorDecorationsCollection): boolean {

		const lineNumber = selection.startLineNumber;
		const startColumn = selection.startColumn;
		const endColumn = selection.endColumn;
		const currentWordRange = this._getCurrentWordRange(model, selection);

		let requestIsValid = Boolean(this._wordRange && this._wordRange.equalsRange(currentWordRange));

		// Even if we are on a different word, if that word is in the decorations ranges, the request is still valid
		// (Same symbol)
		for (let i = 0, len = decorations.length; !requestIsValid && i < len; i++) {
			const range = decorations.getRange(i);
			if (range && range.startLineNumber === lineNumber) {
				if (range.startColumn <= startColumn && range.endColumn >= endColumn) {
					requestIsValid = true;
				}
			}
		}

		return requestIsValid;
	}

	public cancel(): void {
		this.result.cancel();
	}
}

class SemanticOccurenceAtPositionRequest extends OccurenceAtPositionRequest {

	private readonly _providers: LanguageFeatureRegistry<DocumentHighlightProvider>;

	constructor(model: ITextModel, selection: Selection, wordSeparators: string, providers: LanguageFeatureRegistry<DocumentHighlightProvider>) {
		super(model, selection, wordSeparators);
		this._providers = providers;
	}

	protected _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>> {
		return getOccurrencesAtPosition(this._providers, model, selection.getPosition(), token).then(value => {
			if (!value) {
				return new ResourceMap<DocumentHighlight[]>();
			}
			return value;
		});
	}
}

class MultiModelOccurenceRequest extends OccurenceAtPositionRequest {
	private readonly _providers: LanguageFeatureRegistry<MultiDocumentHighlightProvider>;
	private readonly _otherModels: ITextModel[];

	constructor(model: ITextModel, selection: Selection, wordSeparators: string, providers: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, otherModels: ITextModel[]) {
		super(model, selection, wordSeparators);
		this._providers = providers;
		this._otherModels = otherModels;
	}

	protected override _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>> {
		return getOccurrencesAcrossMultipleModels(this._providers, model, selection.getPosition(), wordSeparators, token, this._otherModels).then(value => {
			if (!value) {
				return new ResourceMap<DocumentHighlight[]>();
			}
			return value;
		});
	}
}

class TextualOccurenceRequest extends OccurenceAtPositionRequest {

	private readonly _otherModels: ITextModel[];
	private readonly _selectionIsEmpty: boolean;
	private readonly _word: IWordAtPosition | null;

	constructor(model: ITextModel, selection: Selection, word: IWordAtPosition | null, wordSeparators: string, otherModels: ITextModel[]) {
		super(model, selection, wordSeparators);
		this._otherModels = otherModels;
		this._selectionIsEmpty = selection.isEmpty();
		this._word = word;
	}

	protected _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>> {
		return timeout(250, token).then(() => {
			const result = new ResourceMap<DocumentHighlight[]>();

			let wordResult;
			if (this._word) {
				wordResult = this._word;
			} else {
				wordResult = model.getWordAtPosition(selection.getPosition());
			}

			if (!wordResult) {
				return new ResourceMap<DocumentHighlight[]>();
			}

			const allModels = [model, ...this._otherModels];

			for (const otherModel of allModels) {
				if (otherModel.isDisposed()) {
					continue;
				}

				const matches = otherModel.findMatches(wordResult.word, true, false, true, wordSeparators, false);
				const highlights = matches.map(m => ({
					range: m.range,
					kind: DocumentHighlightKind.Text
				}));

				if (highlights) {
					result.set(otherModel.uri, highlights);
				}
			}
			return result;
		});
	}

	public override isValid(model: ITextModel, selection: Selection, decorations: IEditorDecorationsCollection): boolean {
		const currentSelectionIsEmpty = selection.isEmpty();
		if (this._selectionIsEmpty !== currentSelectionIsEmpty) {
			return false;
		}
		return super.isValid(model, selection, decorations);
	}
}

function computeOccurencesAtPosition(registry: LanguageFeatureRegistry<DocumentHighlightProvider>, model: ITextModel, selection: Selection, word: IWordAtPosition | null, wordSeparators: string): IOccurenceAtPositionRequest {
	if (registry.has(model)) {
		return new SemanticOccurenceAtPositionRequest(model, selection, wordSeparators, registry);
	}
	return new TextualOccurenceRequest(model, selection, word, wordSeparators, []);
}

function computeOccurencesMultiModel(registry: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, model: ITextModel, selection: Selection, word: IWordAtPosition | null, wordSeparators: string, otherModels: ITextModel[]): IOccurenceAtPositionRequest {
	if (registry.has(model)) {
		return new MultiModelOccurenceRequest(model, selection, wordSeparators, registry, otherModels);
	}
	return new TextualOccurenceRequest(model, selection, word, wordSeparators, otherModels);
}

registerModelAndPositionCommand('_executeDocumentHighlights', async (accessor, model, position) => {
	const languageFeaturesService = accessor.get(ILanguageFeaturesService);
	const map = await getOccurrencesAtPosition(languageFeaturesService.documentHighlightProvider, model, position, CancellationToken.None);
	return map?.get(model.uri);
});

class WordHighlighter {

	private readonly editor: IActiveCodeEditor;
	private readonly providers: LanguageFeatureRegistry<DocumentHighlightProvider>;
	private readonly multiDocumentProviders: LanguageFeatureRegistry<MultiDocumentHighlightProvider>;
	private occurrencesHighlight: string;
	private readonly model: ITextModel;
	private readonly decorations: IEditorDecorationsCollection;
	private readonly toUnhook = new DisposableStore();
	private readonly codeEditorService: ICodeEditorService;

	private workerRequestTokenId: number = 0;
	private workerRequest: IOccurenceAtPositionRequest | null;
	private workerRequestCompleted: boolean = false;
	private workerRequestValue: ResourceMap<DocumentHighlight[]> = new ResourceMap();

	private lastCursorPositionChangeTime: number = 0;
	private renderDecorationsTimer: any = -1;

	private readonly _hasWordHighlights: IContextKey<boolean>;
	private _ignorePositionChangeEvent: boolean;

	private static storedDecorations: ResourceMap<string[]> = new ResourceMap();
	private static query: IWordHighlighterQuery | null = null;

	constructor(editor: IActiveCodeEditor, providers: LanguageFeatureRegistry<DocumentHighlightProvider>, multiProviders: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, contextKeyService: IContextKeyService, @ICodeEditorService codeEditorService: ICodeEditorService) {
		this.editor = editor;
		this.providers = providers;
		this.multiDocumentProviders = multiProviders;
		this.codeEditorService = codeEditorService;
		this._hasWordHighlights = ctxHasWordHighlights.bindTo(contextKeyService);
		this._ignorePositionChangeEvent = false;
		this.occurrencesHighlight = this.editor.getOption(EditorOption.occurrencesHighlight);
		this.model = this.editor.getModel();
		this.toUnhook.add(editor.onDidChangeCursorPosition((e: ICursorPositionChangedEvent) => {
			if (this._ignorePositionChangeEvent) {
				// We are changing the position => ignore this event
				return;
			}

			if (this.occurrencesHighlight === 'off') {
				// Early exit if nothing needs to be done!
				// Leave some form of early exit check here if you wish to continue being a cursor position change listener ;)
				return;
			}

			this._onPositionChanged(e);
		}));
		this.toUnhook.add(editor.onDidFocusEditorText((e) => {
			if (this.occurrencesHighlight === 'off') {
				// Early exit if nothing needs to be done
				return;
			}

			if (!this.workerRequest) {
				this._run();
			}
		}));
		this.toUnhook.add(editor.onDidChangeModelContent((e) => {
			this._stopAll();
		}));
		this.toUnhook.add(editor.onDidChangeModel((e) => {
			if (!e.newModelUrl && e.oldModelUrl) {
				this._stopSingular();
			} else {
				if (WordHighlighter.query) {
					this._run();
				}
			}
		}));
		this.toUnhook.add(editor.onDidChangeConfiguration((e) => {
			const newValue = this.editor.getOption(EditorOption.occurrencesHighlight);
			if (this.occurrencesHighlight !== newValue) {
				this.occurrencesHighlight = newValue;
				this._stopAll();
			}
		}));

		this.decorations = this.editor.createDecorationsCollection();
		this.workerRequestTokenId = 0;
		this.workerRequest = null;
		this.workerRequestCompleted = false;

		this.lastCursorPositionChangeTime = 0;
		this.renderDecorationsTimer = -1;

		// if there is a query already, highlight off that query
		if (WordHighlighter.query) {
			this._run();
		}
	}

	public hasDecorations(): boolean {
		return (this.decorations.length > 0);
	}

	public restore(): void {
		if (this.occurrencesHighlight === 'off') {
			return;
		}
		this._run();
	}

	public stop(): void {
		if (this.occurrencesHighlight === 'off') {
			return;
		}

		this._stopAll();
	}

	private _getSortedHighlights(): Range[] {
		return (
			this.decorations.getRanges()
				.sort(Range.compareRangesUsingStarts)
		);
	}

	public moveNext() {
		const highlights = this._getSortedHighlights();
		const index = highlights.findIndex((range) => range.containsPosition(this.editor.getPosition()));
		const newIndex = ((index + 1) % highlights.length);
		const dest = highlights[newIndex];
		try {
			this._ignorePositionChangeEvent = true;
			this.editor.setPosition(dest.getStartPosition());
			this.editor.revealRangeInCenterIfOutsideViewport(dest);
			const word = this._getWord();
			if (word) {
				const lineContent = this.editor.getModel().getLineContent(dest.startLineNumber);
				alert(`${lineContent}, ${newIndex + 1} of ${highlights.length} for '${word.word}'`);
			}
		} finally {
			this._ignorePositionChangeEvent = false;
		}
	}

	public moveBack() {
		const highlights = this._getSortedHighlights();
		const index = highlights.findIndex((range) => range.containsPosition(this.editor.getPosition()));
		const newIndex = ((index - 1 + highlights.length) % highlights.length);
		const dest = highlights[newIndex];
		try {
			this._ignorePositionChangeEvent = true;
			this.editor.setPosition(dest.getStartPosition());
			this.editor.revealRangeInCenterIfOutsideViewport(dest);
			const word = this._getWord();
			if (word) {
				const lineContent = this.editor.getModel().getLineContent(dest.startLineNumber);
				alert(`${lineContent}, ${newIndex + 1} of ${highlights.length} for '${word.word}'`);
			}
		} finally {
			this._ignorePositionChangeEvent = false;
		}
	}

	private _removeSingleDecorations(): void {
		// return if no model
		if (!this.editor.hasModel()) {
			return;
		}

		const currentDecorationIDs = WordHighlighter.storedDecorations.get(this.editor.getModel().uri);
		if (!currentDecorationIDs) {
			return;
		}

		this.editor.removeDecorations(currentDecorationIDs);
		WordHighlighter.storedDecorations.delete(this.editor.getModel().uri);

		if (this.decorations.length > 0) {
			this.decorations.clear();
			this._hasWordHighlights.set(false);
		}
	}

	private _removeAllDecorations(): void {
		const currentEditors = this.codeEditorService.listCodeEditors();
		const deleteURI = [];
		// iterate over editors and store models in currentModels
		for (const editor of currentEditors) {
			if (!editor.hasModel()) {
				continue;
			}

			const currentDecorationIDs = WordHighlighter.storedDecorations.get(editor.getModel().uri);
			if (!currentDecorationIDs) {
				continue;
			}

			editor.removeDecorations(currentDecorationIDs);
			deleteURI.push(editor.getModel().uri);

			const editorHighlighterContrib = WordHighlighterContribution.get(editor);
			if (!editorHighlighterContrib?.wordHighlighter) {
				continue;
			}

			if (editorHighlighterContrib.wordHighlighter.decorations.length > 0) {
				editorHighlighterContrib.wordHighlighter.decorations.clear();
				editorHighlighterContrib.wordHighlighter.workerRequest = null;
				editorHighlighterContrib.wordHighlighter._hasWordHighlights.set(false);
			}
		}

		for (const uri of deleteURI) {
			WordHighlighter.storedDecorations.delete(uri);
		}
	}

	private _stopSingular(): void {
		// Remove any existing decorations + a possible query, and re - run to update decorations
		this._removeSingleDecorations();

		if (this.editor.hasTextFocus()) {
			if (this.editor.getModel()?.uri.scheme !== Schemas.vscodeNotebookCell && WordHighlighter.query?.modelInfo?.model.uri.scheme !== Schemas.vscodeNotebookCell) { // clear query if focused non-nb editor
				WordHighlighter.query = null;
				this._run(); // TODO: @Yoyokrazy -- investigate why we need a full rerun here. likely addressed a case/patch in the first iteration of this feature
			} else { // remove modelInfo to account for nb cell being disposed
				if (WordHighlighter.query?.modelInfo) {
					WordHighlighter.query.modelInfo = null;
				}
			}
		}

		// Cancel any renderDecorationsTimer
		if (this.renderDecorationsTimer !== -1) {
			clearTimeout(this.renderDecorationsTimer);
			this.renderDecorationsTimer = -1;
		}

		// Cancel any worker request
		if (this.workerRequest !== null) {
			this.workerRequest.cancel();
			this.workerRequest = null;
		}

		// Invalidate any worker request callback
		if (!this.workerRequestCompleted) {
			this.workerRequestTokenId++;
			this.workerRequestCompleted = true;
		}
	}

	private _stopAll() {
		// Remove any existing decorations
		// TODO: @Yoyokrazy -- this triggers as notebooks scroll, causing highlights to disappear momentarily.
		// maybe a nb type check?
		this._removeAllDecorations();

		// Cancel any renderDecorationsTimer
		if (this.renderDecorationsTimer !== -1) {
			clearTimeout(this.renderDecorationsTimer);
			this.renderDecorationsTimer = -1;
		}

		// Cancel any worker request
		if (this.workerRequest !== null) {
			this.workerRequest.cancel();
			this.workerRequest = null;
		}

		// Invalidate any worker request callback
		if (!this.workerRequestCompleted) {
			this.workerRequestTokenId++;
			this.workerRequestCompleted = true;
		}
	}

	private _onPositionChanged(e: ICursorPositionChangedEvent): void {

		// disabled
		if (this.occurrencesHighlight === 'off') {
			this._stopAll();
			return;
		}

		// ignore typing & other
		// need to check if the model is a notebook cell, should not stop if nb
		if (e.reason !== CursorChangeReason.Explicit && this.editor.getModel()?.uri.scheme !== Schemas.vscodeNotebookCell) {
			this._stopAll();
			return;
		}

		this._run();
	}

	private _getWord(): IWordAtPosition | null {
		const editorSelection = this.editor.getSelection();
		const lineNumber = editorSelection.startLineNumber;
		const startColumn = editorSelection.startColumn;

		if (this.model.isDisposed()) {
			return null;
		}

		return this.model.getWordAtPosition({
			lineNumber: lineNumber,
			column: startColumn
		});
	}

	private getOtherModelsToHighlight(model: ITextModel): ITextModel[] {
		if (!model) {
			return [];
		}

		// notebook case
		const isNotebookEditor = model.uri.scheme === Schemas.vscodeNotebookCell;
		if (isNotebookEditor) {
			const currentModels: ITextModel[] = [];
			const currentEditors = this.codeEditorService.listCodeEditors();
			for (const editor of currentEditors) {
				const tempModel = editor.getModel();
				if (tempModel && tempModel !== model && tempModel.uri.scheme === Schemas.vscodeNotebookCell) {
					currentModels.push(tempModel);
				}
			}
			return currentModels;
		}

		// inline case
		// ? current works when highlighting outside of an inline diff, highlighting in.
		// ? broken when highlighting within a diff editor. highlighting the main editor does not work
		// ? editor group service could be useful here
		const currentModels: ITextModel[] = [];
		const currentEditors = this.codeEditorService.listCodeEditors();
		for (const editor of currentEditors) {
			if (!isDiffEditor(editor)) {
				continue;
			}
			const diffModel = (editor as IDiffEditor).getModel();
			if (!diffModel) {
				continue;
			}
			if (model === diffModel.modified) { // embedded inline chat diff would pass this, allowing highlights
				//? currentModels.push(diffModel.original);
				currentModels.push(diffModel.modified);
			}
		}
		if (currentModels.length) { // no matching editors have been found
			return currentModels;
		}

		// multi-doc OFF
		if (this.occurrencesHighlight === 'singleFile') {
			return [];
		}

		// multi-doc ON
		for (const editor of currentEditors) {
			const tempModel = editor.getModel();

			const isValidModel = tempModel && tempModel !== model;

			if (isValidModel) {
				currentModels.push(tempModel);
			}
		}
		return currentModels;
	}

	private _run(): void {

		let workerRequestIsValid;
		const hasTextFocus = this.editor.hasTextFocus();

		if (!hasTextFocus) { // new nb cell scrolled in, didChangeModel fires
			if (!WordHighlighter.query) { // no previous query, nothing to highlight off of
				return;
			}
		} else { // has text focus
			const editorSelection = this.editor.getSelection();

			// ignore multiline selection
			if (!editorSelection || editorSelection.startLineNumber !== editorSelection.endLineNumber) {
				WordHighlighter.query = null;
				this._stopAll();
				return;
			}

			const startColumn = editorSelection.startColumn;
			const endColumn = editorSelection.endColumn;

			const word = this._getWord();

			// The selection must be inside a word or surround one word at most
			if (!word || word.startColumn > startColumn || word.endColumn < endColumn) {
				// no previous query, nothing to highlight
				WordHighlighter.query = null;
				this._stopAll();
				return;
			}

			// All the effort below is trying to achieve this:
			// - when cursor is moved to a word, trigger immediately a findOccurrences request
			// - 250ms later after the last cursor move event, render the occurrences
			// - no flickering!
			workerRequestIsValid = (this.workerRequest && this.workerRequest.isValid(this.model, editorSelection, this.decorations));

			WordHighlighter.query = {
				modelInfo: {
					model: this.model,
					selection: editorSelection,
				},
				word: word
			};
		}

		// There are 4 cases:
		// a) old workerRequest is valid & completed, renderDecorationsTimer fired
		// b) old workerRequest is valid & completed, renderDecorationsTimer not fired
		// c) old workerRequest is valid, but not completed
		// d) old workerRequest is not valid

		// For a) no action is needed
		// For c), member 'lastCursorPositionChangeTime' will be used when installing the timer so no action is needed

		this.lastCursorPositionChangeTime = (new Date()).getTime();

		if (workerRequestIsValid) {
			if (this.workerRequestCompleted && this.renderDecorationsTimer !== -1) {
				// case b)
				// Delay the firing of renderDecorationsTimer by an extra 250 ms
				clearTimeout(this.renderDecorationsTimer);
				this.renderDecorationsTimer = -1;
				this._beginRenderDecorations();
			}
		} else {
			// case d)
			// Stop all previous actions and start fresh
			this._stopAll();

			const myRequestId = ++this.workerRequestTokenId;
			this.workerRequestCompleted = false;

			const otherModelsToHighlight = this.getOtherModelsToHighlight(this.editor.getModel());

			// when reaching here, there are two possible states.
			// 		1) we have text focus, and a valid query was updated.
			// 		2) we do not have text focus, and a valid query is cached.
			// the query will ALWAYS have the correct data for the current highlight request, so it can always be passed to the workerRequest safely
			if (!WordHighlighter.query.modelInfo || WordHighlighter.query.modelInfo.model.isDisposed()) {
				return;
			}
			this.workerRequest = this.computeWithModel(WordHighlighter.query.modelInfo.model, WordHighlighter.query.modelInfo.selection, WordHighlighter.query.word, otherModelsToHighlight);

			this.workerRequest?.result.then(data => {
				if (myRequestId === this.workerRequestTokenId) {
					this.workerRequestCompleted = true;
					this.workerRequestValue = data || [];
					this._beginRenderDecorations();
				}
			}, onUnexpectedError);
		}
	}

	private computeWithModel(model: ITextModel, selection: Selection, word: IWordAtPosition | null, otherModels: ITextModel[]): IOccurenceAtPositionRequest | null {
		if (!otherModels.length) {
			return computeOccurencesAtPosition(this.providers, model, selection, word, this.editor.getOption(EditorOption.wordSeparators));
		} else {
			return computeOccurencesMultiModel(this.multiDocumentProviders, model, selection, word, this.editor.getOption(EditorOption.wordSeparators), otherModels);
		}
	}

	private _beginRenderDecorations(): void {
		const currentTime = (new Date()).getTime();
		const minimumRenderTime = this.lastCursorPositionChangeTime + 250;

		if (currentTime >= minimumRenderTime) {
			// Synchronous
			this.renderDecorationsTimer = -1;
			this.renderDecorations();
		} else {
			// Asynchronous
			this.renderDecorationsTimer = setTimeout(() => {
				this.renderDecorations();
			}, (minimumRenderTime - currentTime));
		}
	}

	private renderDecorations(): void {
		this.renderDecorationsTimer = -1;
		// create new loop, iterate over current editors using this.codeEditorService.listCodeEditors(),
		// if the URI of that codeEditor is in the map, then add the decorations to the decorations array
		// then set the decorations for the editor
		const currentEditors = this.codeEditorService.listCodeEditors();
		for (const editor of currentEditors) {
			const editorHighlighterContrib = WordHighlighterContribution.get(editor);
			if (!editorHighlighterContrib) {
				continue;
			}

			const newDecorations: IModelDeltaDecoration[] = [];
			const uri = editor.getModel()?.uri;
			if (uri && this.workerRequestValue.has(uri)) {
				const oldDecorationIDs: string[] | undefined = WordHighlighter.storedDecorations.get(uri);
				const newDocumentHighlights = this.workerRequestValue.get(uri);
				if (newDocumentHighlights) {
					for (const highlight of newDocumentHighlights) {
						if (!highlight.range) {
							continue;
						}
						newDecorations.push({
							range: highlight.range,
							options: getHighlightDecorationOptions(highlight.kind)
						});
					}
				}

				let newDecorationIDs: string[] = [];
				editor.changeDecorations((changeAccessor) => {
					newDecorationIDs = changeAccessor.deltaDecorations(oldDecorationIDs ?? [], newDecorations);
				});
				WordHighlighter.storedDecorations = WordHighlighter.storedDecorations.set(uri, newDecorationIDs);

				if (newDecorations.length > 0) {
					editorHighlighterContrib.wordHighlighter?.decorations.set(newDecorations);
					editorHighlighterContrib.wordHighlighter?._hasWordHighlights.set(true);
				}
			}
		}
	}

	public dispose(): void {
		this._stopSingular();
		this.toUnhook.dispose();
	}
}

export class WordHighlighterContribution extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.wordHighlighter';

	public static get(editor: ICodeEditor): WordHighlighterContribution | null {
		return editor.getContribution<WordHighlighterContribution>(WordHighlighterContribution.ID);
	}

	private _wordHighlighter: WordHighlighter | null;

	constructor(editor: ICodeEditor, @IContextKeyService contextKeyService: IContextKeyService, @ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService, @ICodeEditorService codeEditorService: ICodeEditorService) {
		super();
		this._wordHighlighter = null;
		const createWordHighlighterIfPossible = () => {
			if (editor.hasModel() && !editor.getModel().isTooLargeForTokenization()) {
				this._wordHighlighter = new WordHighlighter(editor, languageFeaturesService.documentHighlightProvider, languageFeaturesService.multiDocumentHighlightProvider, contextKeyService, codeEditorService);
			}
		};
		this._register(editor.onDidChangeModel((e) => {
			if (this._wordHighlighter) {
				this._wordHighlighter.dispose();
				this._wordHighlighter = null;
			}
			createWordHighlighterIfPossible();
		}));
		createWordHighlighterIfPossible();
	}

	public get wordHighlighter(): WordHighlighter | null {
		return this._wordHighlighter;
	}

	public saveViewState(): boolean {
		if (this._wordHighlighter && this._wordHighlighter.hasDecorations()) {
			return true;
		}
		return false;
	}

	public moveNext() {
		this._wordHighlighter?.moveNext();
	}

	public moveBack() {
		this._wordHighlighter?.moveBack();
	}

	public restoreViewState(state: boolean | undefined): void {
		if (this._wordHighlighter && state) {
			this._wordHighlighter.restore();
		}
	}

	public stopHighlighting() {
		this._wordHighlighter?.stop();
	}

	public override dispose(): void {
		if (this._wordHighlighter) {
			this._wordHighlighter.dispose();
			this._wordHighlighter = null;
		}
		super.dispose();
	}
}


class WordHighlightNavigationAction extends EditorAction {

	private readonly _isNext: boolean;

	constructor(next: boolean, opts: IActionOptions) {
		super(opts);
		this._isNext = next;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const controller = WordHighlighterContribution.get(editor);
		if (!controller) {
			return;
		}

		if (this._isNext) {
			controller.moveNext();
		} else {
			controller.moveBack();
		}
	}
}

class NextWordHighlightAction extends WordHighlightNavigationAction {
	constructor() {
		super(true, {
			id: 'editor.action.wordHighlight.next',
			label: nls.localize('wordHighlight.next.label', "Go to Next Symbol Highlight"),
			alias: 'Go to Next Symbol Highlight',
			precondition: ctxHasWordHighlights,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyCode.F7,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}

class PrevWordHighlightAction extends WordHighlightNavigationAction {
	constructor() {
		super(false, {
			id: 'editor.action.wordHighlight.prev',
			label: nls.localize('wordHighlight.previous.label', "Go to Previous Symbol Highlight"),
			alias: 'Go to Previous Symbol Highlight',
			precondition: ctxHasWordHighlights,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Shift | KeyCode.F7,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}

class TriggerWordHighlightAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.wordHighlight.trigger',
			label: nls.localize('wordHighlight.trigger.label', "Trigger Symbol Highlight"),
			alias: 'Trigger Symbol Highlight',
			precondition: ctxHasWordHighlights.toNegated(),
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: 0,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
		const controller = WordHighlighterContribution.get(editor);
		if (!controller) {
			return;
		}

		controller.restoreViewState(true);
	}
}

registerEditorContribution(WordHighlighterContribution.ID, WordHighlighterContribution, EditorContributionInstantiation.Eager); // eager because it uses `saveViewState`/`restoreViewState`
registerEditorAction(NextWordHighlightAction);
registerEditorAction(PrevWordHighlightAction);
registerEditorAction(TriggerWordHighlightAction);
// registerEditorFeature(TextualMultiDocumentHighlightFeature);
