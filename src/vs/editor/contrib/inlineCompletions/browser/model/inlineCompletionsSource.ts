/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { equalsIfDefined, itemEquals } from '../../../../../base/common/equals.js';
import { matchesSubString } from '../../../../../base/common/filters.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, IReader, ISettableObservable, ITransaction, derivedOpts, disposableObservableValue, observableFromEvent, observableValue, transaction } from '../../../../../base/common/observable.js';
import { splitLines } from '../../../../../base/common/strings.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { OffsetEdit, SingleOffsetEdit } from '../../../../common/core/offsetEdit.js';
import { OffsetRange } from '../../../../common/core/offsetRange.js';
import { Position } from '../../../../common/core/position.js';
import { Range } from '../../../../common/core/range.js';
import { SingleTextEdit, StringText } from '../../../../common/core/textEdit.js';
import { TextLength } from '../../../../common/core/textLength.js';
import { linesDiffComputers } from '../../../../common/diff/linesDiffComputers.js';
import { InlineCompletionContext, InlineCompletionTriggerKind } from '../../../../common/languages.js';
import { ILanguageConfigurationService } from '../../../../common/languages/languageConfigurationRegistry.js';
import { EndOfLinePreference, ITextModel } from '../../../../common/model.js';
import { IFeatureDebounceInformation } from '../../../../common/services/languageFeatureDebounce.js';
import { ILanguageFeaturesService } from '../../../../common/services/languageFeatures.js';
import { IModelContentChange, IModelContentChangedEvent } from '../../../../common/textModelEvents.js';
import { InlineCompletionItem, InlineCompletionProviderResult, provideInlineCompletions } from './provideInlineCompletions.js';
import { singleTextRemoveCommonPrefix } from './singleTextEditHelpers.js';

export class InlineCompletionsSource extends Disposable {
	private static _requestId = 0;

	private readonly _updateOperation = this._register(new MutableDisposable<UpdateOperation>());
	public readonly inlineCompletions = disposableObservableValue<UpToDateInlineCompletions | undefined>('inlineCompletions', undefined);
	public readonly suggestWidgetInlineCompletions = disposableObservableValue<UpToDateInlineCompletions | undefined>('suggestWidgetInlineCompletions', undefined);

	private readonly _loggingEnabled = observableConfigValue('editor.inlineSuggest.logFetch', false, this._configurationService).recomputeInitiallyAndOnChange(this._store);
	private readonly _invalidationDelay = observableConfigValue<number>('editor.inlineSuggest.edits.experimental.invalidationDelay', 4000, this._configurationService).recomputeInitiallyAndOnChange(this._store);

	private readonly _structuredFetchLogger = this._register(this._instantiationService.createInstance(StructuredLogger.cast<
		{ kind: 'start'; requestId: number; context: unknown } & IRecordableEditorLogEntry
		| { kind: 'end'; error: any; durationMs: number; result: unknown; requestId: number } & IRecordableLogEntry
	>(),
		'editor.inlineSuggest.logFetch.commandId'
	));

	constructor(
		private readonly _textModel: ITextModel,
		private readonly _versionId: IObservable<number | null>,
		private readonly _debounceValue: IFeatureDebounceInformation,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ILanguageConfigurationService private readonly _languageConfigurationService: ILanguageConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._register(this._textModel.onDidChangeContent((e) => {
			this._updateOperation.clear();

			const inlineCompletions = this.inlineCompletions.get();
			if (inlineCompletions) {
				transaction(tx => {
					inlineCompletions.acceptTextModelChangeEvent(e, tx);
				});
			}
		}));
	}

	private _log(entry:
		{ sourceId: string; kind: 'start'; requestId: number; context: unknown } & IRecordableEditorLogEntry
		| { sourceId: string; kind: 'end'; error: any; durationMs: number; result: unknown; requestId: number } & IRecordableLogEntry
	) {
		if (this._loggingEnabled.get()) {
			this._logService.info(formatRecordableLogEntry(entry));
		}
		this._structuredFetchLogger.log(entry);
	}

	public readonly loading = observableValue(this, false);

	public fetch(position: Position, context: InlineCompletionContext, activeInlineCompletion: InlineCompletionWithUpdatedRange | undefined): Promise<boolean> {
		const request = new UpdateRequest(position, context, this._textModel.getVersionId());

		const target = context.selectedSuggestionInfo ? this.suggestWidgetInlineCompletions : this.inlineCompletions;

		if (this._updateOperation.value?.request.satisfies(request)) {
			return this._updateOperation.value.promise;
		} else if (target.get()?.request.satisfies(request)) {
			return Promise.resolve(true);
		}

		this.loading.set(true, undefined);

		const updateOngoing = !!this._updateOperation.value;
		this._updateOperation.clear();

		const source = new CancellationTokenSource();

		const promise = (async () => {
			const shouldDebounce = updateOngoing || context.triggerKind === InlineCompletionTriggerKind.Automatic;
			if (shouldDebounce) {
				// This debounces the operation
				await wait(this._debounceValue.get(this._textModel), source.token);
			}

			if (source.token.isCancellationRequested || this._store.isDisposed || this._textModel.getVersionId() !== request.versionId) {
				return false;
			}

			const requestId = InlineCompletionsSource._requestId++;
			if (this._loggingEnabled.get() || this._structuredFetchLogger.isEnabled.get()) {
				this._log({ sourceId: 'InlineCompletions.fetch', kind: 'start', requestId, modelUri: this._textModel.uri.toString(), modelVersion: this._textModel.getVersionId(), context: { triggerKind: context.triggerKind }, time: Date.now() });
			}

			const startTime = new Date();
			let updatedCompletions: InlineCompletionProviderResult | undefined = undefined;
			let error: any = undefined;
			try {
				updatedCompletions = await provideInlineCompletions(
					this._languageFeaturesService.inlineCompletionsProvider,
					position,
					this._textModel,
					context,
					source.token,
					this._languageConfigurationService
				);
			} catch (e) {
				error = e;
				throw e;
			} finally {
				if (this._loggingEnabled.get() || this._structuredFetchLogger.isEnabled.get()) {
					if (source.token.isCancellationRequested || this._store.isDisposed || this._textModel.getVersionId() !== request.versionId) {
						error = 'canceled';
					}
					const result = updatedCompletions?.completions.map(c => ({
						range: c.range.toString(),
						text: c.insertText,
						isInlineEdit: !!c.sourceInlineCompletion.isInlineEdit,
						source: c.source.provider.groupId,
					}));
					this._log({ sourceId: 'InlineCompletions.fetch', kind: 'end', requestId, durationMs: (Date.now() - startTime.getTime()), error, result, time: Date.now() });
				}
			}

			if (source.token.isCancellationRequested || this._store.isDisposed || this._textModel.getVersionId() !== request.versionId) {
				updatedCompletions.dispose();
				return false;
			}

			// Reuse Inline Edit if possible
			if (activeInlineCompletion && activeInlineCompletion.isInlineEdit && (activeInlineCompletion.canBeReused(this._textModel, position) || updatedCompletions.has(activeInlineCompletion.inlineCompletion) /* Inline Edit wins over completions if it's already been shown*/)) {
				updatedCompletions.dispose();
				return false;
			}

			const endTime = new Date();
			this._debounceValue.update(this._textModel, endTime.getTime() - startTime.getTime());

			// Reuse Inline Completion if possible
			const completions = new UpToDateInlineCompletions(updatedCompletions, request, this._textModel, this._versionId, this._invalidationDelay);
			if (activeInlineCompletion && !activeInlineCompletion.isInlineEdit && activeInlineCompletion.canBeReused(this._textModel, position)) {
				const asInlineCompletion = activeInlineCompletion.toInlineCompletion(undefined);
				if (!updatedCompletions.has(asInlineCompletion)) {
					completions.prepend(activeInlineCompletion.inlineCompletion, asInlineCompletion.range, true);
				}
			}

			this._updateOperation.clear();
			transaction(tx => {
				/** @description Update completions with provider result */
				target.set(completions, tx);
				this.loading.set(false, tx);
			});

			return true;
		})();

		const updateOperation = new UpdateOperation(request, source, promise);
		this._updateOperation.value = updateOperation;

		return promise;
	}

	public clear(tx: ITransaction): void {
		this._updateOperation.clear();
		this.inlineCompletions.set(undefined, tx);
		this.suggestWidgetInlineCompletions.set(undefined, tx);
	}

	public clearSuggestWidgetInlineCompletions(tx: ITransaction): void {
		if (this._updateOperation.value?.request.context.selectedSuggestionInfo) {
			this._updateOperation.clear();
		}
		this.suggestWidgetInlineCompletions.set(undefined, tx);
	}

	public cancelUpdate(): void {
		this._updateOperation.clear();
	}
}

function wait(ms: number, cancellationToken?: CancellationToken): Promise<void> {
	return new Promise(resolve => {
		let d: IDisposable | undefined = undefined;
		const handle = setTimeout(() => {
			if (d) { d.dispose(); }
			resolve();
		}, ms);
		if (cancellationToken) {
			d = cancellationToken.onCancellationRequested(() => {
				clearTimeout(handle);
				if (d) { d.dispose(); }
				resolve();
			});
		}
	});
}

class UpdateRequest {
	constructor(
		public readonly position: Position,
		public readonly context: InlineCompletionContext,
		public readonly versionId: number,
	) {
	}

	public satisfies(other: UpdateRequest): boolean {
		return this.position.equals(other.position)
			&& equalsIfDefined(this.context.selectedSuggestionInfo, other.context.selectedSuggestionInfo, itemEquals())
			&& (other.context.triggerKind === InlineCompletionTriggerKind.Automatic
				|| this.context.triggerKind === InlineCompletionTriggerKind.Explicit)
			&& this.versionId === other.versionId;
	}

	public get isExplicitRequest() {
		return this.context.triggerKind === InlineCompletionTriggerKind.Explicit;
	}
}

class UpdateOperation implements IDisposable {
	constructor(
		public readonly request: UpdateRequest,
		public readonly cancellationTokenSource: CancellationTokenSource,
		public readonly promise: Promise<boolean>,
	) {
	}

	dispose() {
		this.cancellationTokenSource.cancel();
	}
}

export class UpToDateInlineCompletions implements IDisposable {
	private readonly _inlineCompletions: InlineCompletionWithUpdatedRange[];
	public get inlineCompletions(): ReadonlyArray<InlineCompletionWithUpdatedRange> { return this._inlineCompletions; }

	private _refCount = 1;
	private readonly _prependedInlineCompletionItems: InlineCompletionItem[] = [];

	constructor(
		private readonly inlineCompletionProviderResult: InlineCompletionProviderResult,
		public readonly request: UpdateRequest,
		private readonly _textModel: ITextModel,
		private readonly _versionId: IObservable<number | null>,
		private readonly _invalidationDelay: IObservable<number>,
	) {
		const ids = _textModel.deltaDecorations([], inlineCompletionProviderResult.completions.map(i => ({
			range: i.range,
			options: {
				description: 'inline-completion-tracking-range'
			},
		})));

		this._inlineCompletions = inlineCompletionProviderResult.completions.map(
			(i, index) => new InlineCompletionWithUpdatedRange(i, ids[index], this._textModel, this._versionId, this._invalidationDelay, this.request)
		);
	}

	public acceptTextModelChangeEvent(e: IModelContentChangedEvent, tx: ITransaction) {
		for (const inlineCompletion of this._inlineCompletions) {
			inlineCompletion.acceptTextModelChangeEvent(e, tx);
		}
	}

	public clone(): this {
		this._refCount++;
		return this;
	}

	public dispose(): void {
		this._refCount--;
		if (this._refCount === 0) {
			setTimeout(() => {
				// To fix https://github.com/microsoft/vscode/issues/188348
				if (!this._textModel.isDisposed()) {
					// This is just cleanup. It's ok if it happens with a delay.
					this._textModel.deltaDecorations(this._inlineCompletions.map(i => i.decorationId), []);
				}
			}, 0);
			this.inlineCompletionProviderResult.dispose();
			for (const i of this._prependedInlineCompletionItems) {
				i.source.removeRef();
			}
		}
	}

	public prepend(inlineCompletion: InlineCompletionItem, range: Range, addRefToSource: boolean): void {
		if (addRefToSource) {
			inlineCompletion.source.addRef();
		}

		const id = this._textModel.deltaDecorations([], [{
			range,
			options: {
				description: 'inline-completion-tracking-range'
			},
		}])[0];
		this._inlineCompletions.unshift(new InlineCompletionWithUpdatedRange(inlineCompletion, id, this._textModel, this._versionId, this._invalidationDelay, this.request));
		this._prependedInlineCompletionItems.push(inlineCompletion);
	}
}

export class InlineCompletionWithUpdatedRange {
	public readonly semanticId = JSON.stringify([
		this.inlineCompletion.filterText,
		this.inlineCompletion.insertText,
		this.inlineCompletion.range.getStartPosition().toString()
	]);

	public get forwardStable() {
		return this.source.inlineCompletions.enableForwardStability ?? false;
	}

	private readonly _updatedRange = derivedOpts<Range | null>({ owner: this, equalsFn: Range.equalsRange }, reader => {
		if (this._inlineEdit.read(reader)) {
			const edit = this.toSingleTextEdit(reader);
			return (edit.isEmpty ? null : edit.range);
		} else {
			this._modelVersion.read(reader);
			return this._textModel.getDecorationRange(this.decorationId);
		}
	});

	/**
	 * This will be null for ghost text completions
	 */
	private _inlineEdit: ISettableObservable<OffsetEdit | null>;
	public get inlineEdit(): IObservable<OffsetEdit | null> { return this._inlineEdit; }

	public get source() { return this.inlineCompletion.source; }
	public get sourceInlineCompletion() { return this.inlineCompletion.sourceInlineCompletion; }
	public get isInlineEdit() { return this.inlineCompletion.sourceInlineCompletion.isInlineEdit; }

	private _invalidationTime: number | undefined = Date.now() + this._invalidationDelay.get();

	private _lastChangePartOfInlineEdit = false;

	constructor(
		public readonly inlineCompletion: InlineCompletionItem,
		public readonly decorationId: string,
		private readonly _textModel: ITextModel,
		private readonly _modelVersion: IObservable<number | null>,
		private readonly _invalidationDelay: IObservable<number>,
		public readonly request: UpdateRequest,
	) {
		const inlineCompletions = this.inlineCompletion.source.inlineCompletions.items;
		if (inlineCompletions.length > 0 && inlineCompletions[inlineCompletions.length - 1].isInlineEdit) {
			this._inlineEdit = observableValue(this, this._toIndividualEdits(this.inlineCompletion.range, this.inlineCompletion.insertText));
		} else {
			this._inlineEdit = observableValue(this, null);
		}
	}

	private _toIndividualEdits(editRange: Range, _replaceText: string): OffsetEdit {
		const eol = this._textModel.getEOL();
		const editOriginalText = this._textModel.getValueInRange(editRange);
		const editReplaceText = _replaceText.replace(/\r\n|\r|\n/g, eol);

		const diffAlgorithm = linesDiffComputers.getDefault();
		const lineDiffs = diffAlgorithm.computeDiff(
			splitLines(editOriginalText),
			splitLines(editReplaceText),
			{
				ignoreTrimWhitespace: false,
				computeMoves: false,
				extendToSubwords: true,
				maxComputationTimeMs: 500,
			}
		);

		const innerChanges = lineDiffs.changes.flatMap(c => c.innerChanges ?? []);
		if (innerChanges.length === 0) {
			const startOffset = this._textModel.getOffsetAt(editRange.getStartPosition());
			return new OffsetEdit(
				[new SingleOffsetEdit(OffsetRange.ofStartAndLength(startOffset, editOriginalText.length), editReplaceText)]
			);
		}

		function addRangeToPos(pos: Position, range: Range): Range {
			const start = TextLength.fromPosition(range.getStartPosition());
			return TextLength.ofRange(range).createRange(start.addToPosition(pos));
		}

		const modifiedText = new StringText(editReplaceText);

		return new OffsetEdit(
			innerChanges.map(c => {
				const range = addRangeToPos(editRange.getStartPosition(), c.originalRange);
				const startOffset = this._textModel.getOffsetAt(range.getStartPosition());
				const endOffset = this._textModel.getOffsetAt(range.getEndPosition());
				const originalRange = OffsetRange.ofStartAndLength(startOffset, endOffset - startOffset);

				// TODO: EOL are not properly trimmed by the diffAlgorithm #12680
				const replaceText = modifiedText.getValueOfRange(c.modifiedRange);
				const oldText = this._textModel.getValueInRange(range);
				if (replaceText.endsWith(eol) && oldText.endsWith(eol)) {
					return new SingleOffsetEdit(originalRange.deltaEnd(-eol.length), replaceText.slice(0, -eol.length));
				}

				return new SingleOffsetEdit(originalRange, replaceText);
			})
		);
	}

	public acceptTextModelChangeEvent(e: IModelContentChangedEvent, tx: ITransaction): void {
		this._lastChangePartOfInlineEdit = false;

		const offsetEdit = this._inlineEdit.get();
		if (!offsetEdit) {
			return;
		}

		const editUpdates = offsetEdit.edits.map(edit => acceptTextModelChange(edit, e.changes));
		const newEdits = editUpdates.filter(({ changeType }) => changeType !== 'fullyAccepted').map(({ edit }) => edit);

		const emptyEdit = newEdits.find(edit => edit.isEmpty);
		if (emptyEdit || newEdits.length === 0) {
			// Either a change collided with one of our edits, so we will have to drop the completion
			// Or the completion has been typed by the user
			this._inlineEdit.set(new OffsetEdit([emptyEdit ?? new SingleOffsetEdit(new OffsetRange(0, 0), '')]), tx);
			return;
		}

		const changePartiallyAcceptsEdit = editUpdates.some(({ changeType }) => changeType === 'partiallyAccepted' || changeType === 'fullyAccepted');

		if (changePartiallyAcceptsEdit) {
			this._invalidationTime = undefined;
		}
		if (this._invalidationTime && this._invalidationTime < Date.now()) {
			// The completion has been shown for a while and the user
			// has been working on a different part of the document, so invalidate it
			this._inlineEdit.set(new OffsetEdit([new SingleOffsetEdit(new OffsetRange(0, 0), '')]), tx);
			return;
		}

		this._lastChangePartOfInlineEdit = changePartiallyAcceptsEdit;
		this._inlineEdit.set(new OffsetEdit(newEdits), tx);

		function acceptTextModelChange(edit: SingleOffsetEdit, changes: readonly IModelContentChange[]): { edit: SingleOffsetEdit; changeType: 'move' | 'partiallyAccepted' | 'fullyAccepted' } {
			let start = edit.replaceRange.start;
			let end = edit.replaceRange.endExclusive;
			let newText = edit.newText;
			let changeType: 'move' | 'partiallyAccepted' | 'fullyAccepted' = 'move';
			for (let i = changes.length - 1; i >= 0; i--) {
				const change = changes[i];

				// Edit is an insertion: user inserted text at the start of the completion
				if (edit.replaceRange.isEmpty && change.rangeLength === 0 && change.rangeOffset === start && newText.startsWith(change.text)) {
					start += change.text.length;
					end = Math.max(start, end);
					newText = newText.substring(change.text.length);
					changeType = newText.length === 0 ? 'fullyAccepted' : 'partiallyAccepted';
					continue;
				}

				// Edit is a deletion: user deleted text inside the deletion range
				if (!edit.replaceRange.isEmpty && change.text.length === 0 && change.rangeOffset >= start && change.rangeOffset + change.rangeLength <= end) {
					end -= change.rangeLength;
					changeType = start === end ? 'fullyAccepted' : 'partiallyAccepted';
					continue;
				}

				if (change.rangeOffset > end) {
					// the change happens after the completion range
					continue;
				}
				if (change.rangeOffset + change.rangeLength < start) {
					// the change happens before the completion range
					start += change.text.length - change.rangeLength;
					end += change.text.length - change.rangeLength;
					continue;
				}

				// The change intersects the completion, so we will have to drop the completion
				start = change.rangeOffset;
				end = change.rangeOffset;
				newText = '';
			}
			return { edit: new SingleOffsetEdit(new OffsetRange(start, end), newText), changeType };
		}
	}

	public toInlineCompletion(reader: IReader | undefined): InlineCompletionItem {
		const singleTextEdit = this.toSingleTextEdit(reader);
		return this.inlineCompletion.withRangeInsertTextAndFilterText(singleTextEdit.range, singleTextEdit.text, singleTextEdit.text);
	}

	public toSingleTextEdit(reader: IReader | undefined): SingleTextEdit {
		this._modelVersion.read(reader);
		const offsetEdit = this._inlineEdit.read(reader);
		if (!offsetEdit) {
			return new SingleTextEdit(this._updatedRange.read(reader) ?? emptyRange, this.inlineCompletion.insertText);
		}

		const startOffset = offsetEdit.edits[0].replaceRange.start;
		const endOffset = offsetEdit.edits[offsetEdit.edits.length - 1].replaceRange.endExclusive;
		const overallOffsetRange = new OffsetRange(startOffset, endOffset);
		const overallLnColRange = Range.fromPositions(
			this._textModel.getPositionAt(overallOffsetRange.start),
			this._textModel.getPositionAt(overallOffsetRange.endExclusive)
		);
		let text = this._textModel.getValueInRange(overallLnColRange);
		for (let i = offsetEdit.edits.length - 1; i >= 0; i--) {
			const edit = offsetEdit.edits[i];
			const relativeStartOffset = edit.replaceRange.start - startOffset;
			const relativeEndOffset = edit.replaceRange.endExclusive - startOffset;
			text = text.substring(0, relativeStartOffset) + edit.newText + text.substring(relativeEndOffset);
		}
		return new SingleTextEdit(overallLnColRange, text);
	}

	public isVisible(model: ITextModel, cursorPosition: Position, reader: IReader | undefined): boolean {
		const minimizedReplacement = singleTextRemoveCommonPrefix(this._toFilterTextReplacement(reader), model);
		const updatedRange = this._updatedRange.read(reader);
		if (
			!updatedRange
			|| !this.inlineCompletion.range.getStartPosition().equals(updatedRange.getStartPosition())
			|| cursorPosition.lineNumber !== minimizedReplacement.range.startLineNumber
			|| minimizedReplacement.isEmpty // if the completion is empty after removing the common prefix of the completion and the model, the completion item would not be visible
		) {
			return false;
		}

		// We might consider comparing by .toLowerText, but this requires GhostTextReplacement
		const originalValue = model.getValueInRange(minimizedReplacement.range, EndOfLinePreference.LF);
		const filterText = minimizedReplacement.text;

		const cursorPosIndex = Math.max(0, cursorPosition.column - minimizedReplacement.range.startColumn);

		let filterTextBefore = filterText.substring(0, cursorPosIndex);
		let filterTextAfter = filterText.substring(cursorPosIndex);

		let originalValueBefore = originalValue.substring(0, cursorPosIndex);
		let originalValueAfter = originalValue.substring(cursorPosIndex);

		const originalValueIndent = model.getLineIndentColumn(minimizedReplacement.range.startLineNumber);
		if (minimizedReplacement.range.startColumn <= originalValueIndent) {
			// Remove indentation
			originalValueBefore = originalValueBefore.trimStart();
			if (originalValueBefore.length === 0) {
				originalValueAfter = originalValueAfter.trimStart();
			}
			filterTextBefore = filterTextBefore.trimStart();
			if (filterTextBefore.length === 0) {
				filterTextAfter = filterTextAfter.trimStart();
			}
		}

		return filterTextBefore.startsWith(originalValueBefore)
			&& !!matchesSubString(originalValueAfter, filterTextAfter);
	}

	public canBeReused(model: ITextModel, position: Position): boolean {
		const inlineEdit = this._inlineEdit.get();
		if (inlineEdit !== null) {
			return model === this._textModel
				&& !inlineEdit.isEmpty
				&& this._lastChangePartOfInlineEdit;
		}

		const updatedRange = this._updatedRange.read(undefined);
		const result = !!updatedRange
			&& updatedRange.containsPosition(position)
			&& this.isVisible(model, position, undefined)
			&& TextLength.ofRange(updatedRange).isGreaterThanOrEqualTo(TextLength.ofRange(this.inlineCompletion.range));
		return result;
	}

	private _toFilterTextReplacement(reader: IReader | undefined): SingleTextEdit {
		const inlineCompletion = this.toInlineCompletion(reader);
		return new SingleTextEdit(inlineCompletion.range, inlineCompletion.filterText);
	}
}

const emptyRange = new Range(1, 1, 1, 1);

interface IRecordableLogEntry {
	sourceId: string;
	time: number;
}

export interface IRecordableEditorLogEntry extends IRecordableLogEntry {
	modelUri: string;
	modelVersion: number;
}

/**
 * The sourceLabel must not contain '@'!
*/
export function formatRecordableLogEntry<T extends IRecordableLogEntry>(entry: T): string {
	return entry.sourceId + ' @@ ' + JSON.stringify({ ...entry, sourceId: undefined });
}

export class StructuredLogger<T extends IRecordableLogEntry> extends Disposable {
	public static cast<T extends IRecordableLogEntry>(): typeof StructuredLogger<T> {
		return this as typeof StructuredLogger<T>;
	}

	private readonly _contextKeyValue = observableContextKey<string>(this._contextKey, this._contextKeyService).recomputeInitiallyAndOnChange(this._store);

	constructor(
		private readonly _contextKey: string,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();
	}

	public readonly isEnabled = this._contextKeyValue.map(v => v !== undefined);

	public log(data: T): boolean {
		const commandId = this._contextKeyValue.get();
		if (!commandId) {
			return false;
		}
		this._commandService.executeCommand(commandId, data);
		return true;
	}
}

export function observableContextKey<T>(key: string, contextKeyService: IContextKeyService): IObservable<T | undefined> {
	return observableFromEvent(contextKeyService.onDidChangeContext, () => contextKeyService.getContextKeyValue<T>(key));
}
