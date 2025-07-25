/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mapFindFirst } from '../../../../../base/common/arraysFind.js';
import { itemsEquals } from '../../../../../base/common/equals.js';
import { BugIndicatingError, onUnexpectedError, onUnexpectedExternalError } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, IObservableWithChange, IReader, ITransaction, autorun, constObservable, derived, derivedHandleChanges, derivedOpts, mapObservableArrayCached, observableFromEvent, observableSignal, observableValue, recomputeInitiallyAndOnChange, subtransaction, transaction } from '../../../../../base/common/observable.js';
import { commonPrefixLength, firstNonWhitespaceIndex } from '../../../../../base/common/strings.js';
import { isDefined } from '../../../../../base/common/types.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor } from '../../../../browser/editorBrowser.js';
import { observableCodeEditor } from '../../../../browser/observableCodeEditor.js';
import { EditorOption } from '../../../../common/config/editorOptions.js';
import { CursorColumns } from '../../../../common/core/cursorColumns.js';
import { LineRange } from '../../../../common/core/ranges/lineRange.js';
import { Position } from '../../../../common/core/position.js';
import { Range } from '../../../../common/core/range.js';
import { Selection } from '../../../../common/core/selection.js';
import { TextReplacement, TextEdit } from '../../../../common/core/edits/textEdit.js';
import { TextLength } from '../../../../common/core/text/textLength.js';
import { ScrollType } from '../../../../common/editorCommon.js';
import { InlineCompletionEndOfLifeReasonKind, InlineCompletion, InlineCompletionTriggerKind, PartialAcceptTriggerKind, InlineCompletionsProvider, InlineCompletionCommand } from '../../../../common/languages.js';
import { ILanguageConfigurationService } from '../../../../common/languages/languageConfigurationRegistry.js';
import { EndOfLinePreference, IModelDeltaDecoration, ITextModel } from '../../../../common/model.js';
import { TextModelText } from '../../../../common/model/textModelText.js';
import { IFeatureDebounceInformation } from '../../../../common/services/languageFeatureDebounce.js';
import { ILanguageFeaturesService } from '../../../../common/services/languageFeatures.js';
import { IModelContentChangedEvent } from '../../../../common/textModelEvents.js';
import { SnippetController2 } from '../../../snippet/browser/snippetController2.js';
import { addPositions, getEndPositionsAfterApplying, removeTextReplacementCommonSuffixPrefix, substringPos, subtractPositions } from '../utils.js';
import { AnimatedValue, easeOutCubic, ObservableAnimatedValue } from './animation.js';
import { computeGhostText } from './computeGhostText.js';
import { GhostText, GhostTextOrReplacement, ghostTextOrReplacementEquals, ghostTextsOrReplacementsEqual } from './ghostText.js';
import { InlineCompletionsSource } from './inlineCompletionsSource.js';
import { InlineEdit } from './inlineEdit.js';
import { InlineCompletionItem, InlineEditItem, InlineSuggestionItem } from './inlineSuggestionItem.js';
import { InlineCompletionContextWithoutUuid, InlineCompletionEditorType, InlineSuggestRequestInfo } from './provideInlineCompletions.js';
import { singleTextEditAugments, singleTextRemoveCommonPrefix } from './singleTextEditHelpers.js';
import { SuggestItemInfo } from './suggestWidgetAdapter.js';
import { TextModelEditReason, EditReasons } from '../../../../common/textModelEditReason.js';
import { ICodeEditorService } from '../../../../browser/services/codeEditorService.js';
import { InlineCompletionViewData, InlineCompletionViewKind } from '../view/inlineEdits/inlineEditsViewInterface.js';
import { IInlineCompletionsService } from '../../../../browser/services/inlineCompletionsService.js';

export class InlineCompletionsModel extends Disposable {
	private readonly _source;
	private readonly _isActive;
	private readonly _onlyRequestInlineEditsSignal;
	private readonly _forceUpdateExplicitlySignal;
	private readonly _noDelaySignal;

	private readonly _fetchSpecificProviderSignal;

	// We use a semantic id to keep the same inline completion selected even if the provider reorders the completions.
	private readonly _selectedInlineCompletionId;
	public readonly primaryPosition;

	private _isAcceptingPartially;
	public get isAcceptingPartially() { return this._isAcceptingPartially; }

	private readonly _onDidAccept;
	public readonly onDidAccept;

	private readonly _editorObs;

	private readonly _suggestPreviewEnabled;
	private readonly _suggestPreviewMode;
	private readonly _inlineSuggestMode;
	private readonly _suppressedInlineCompletionGroupIds;
	private readonly _inlineEditsEnabled;
	private readonly _inlineEditsShowCollapsedEnabled;
	private readonly _triggerCommandOnProviderChange;

	constructor(
		public readonly textModel: ITextModel,
		private readonly _selectedSuggestItem: IObservable<SuggestItemInfo | undefined>,
		public readonly _textModelVersionId: IObservableWithChange<number | null, IModelContentChangedEvent | undefined>,
		private readonly _positions: IObservable<readonly Position[]>,
		private readonly _debounceValue: IFeatureDebounceInformation,
		private readonly _enabled: IObservable<boolean>,
		private readonly _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICommandService private readonly _commandService: ICommandService,
		@ILanguageConfigurationService private readonly _languageConfigurationService: ILanguageConfigurationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IInlineCompletionsService inlineCompletionsService: IInlineCompletionsService
	) {
		super();
		this.primaryPosition = derived(this, reader => this._positions.read(reader)[0] ?? new Position(1, 1));
		this._source = this._register(this._instantiationService.createInstance(InlineCompletionsSource, this.textModel, this._textModelVersionId, this._debounceValue, this.primaryPosition));
		this._isActive = observableValue<boolean>(this, false);
		this._onlyRequestInlineEditsSignal = observableSignal(this);
		this._forceUpdateExplicitlySignal = observableSignal(this);
		this._noDelaySignal = observableSignal(this);
		this._fetchSpecificProviderSignal = observableSignal<InlineCompletionsProvider | undefined>(this);
		this._selectedInlineCompletionId = observableValue<string | undefined>(this, undefined);
		this._isAcceptingPartially = false;
		this._onDidAccept = new Emitter<void>();
		this.onDidAccept = this._onDidAccept.event;
		this._editorObs = observableCodeEditor(this._editor);
		this._suggestPreviewEnabled = this._editorObs.getOption(EditorOption.suggest).map(v => v.preview);
		this._suggestPreviewMode = this._editorObs.getOption(EditorOption.suggest).map(v => v.previewMode);
		this._inlineSuggestMode = this._editorObs.getOption(EditorOption.inlineSuggest).map(v => v.mode);
		this._suppressedInlineCompletionGroupIds = this._editorObs.getOption(EditorOption.inlineSuggest).map(v => new Set(v.experimental.suppressInlineSuggestions.split(',')));
		this._inlineEditsEnabled = this._editorObs.getOption(EditorOption.inlineSuggest).map(v => !!v.edits.enabled);
		this._inlineEditsShowCollapsedEnabled = this._editorObs.getOption(EditorOption.inlineSuggest).map(s => s.edits.showCollapsed);
		this._triggerCommandOnProviderChange = this._editorObs.getOption(EditorOption.inlineSuggest).map(s => s.experimental.triggerCommandOnProviderChange);
		this._register(inlineCompletionsService.onDidChangeIsSnoozing((isSnoozing) => {
			if (isSnoozing) {
				this.stop();
			}
		}));

		this._lastShownInlineCompletionInfo = undefined;
		this._lastAcceptedInlineCompletionInfo = undefined;
		this._didUndoInlineEdits = derivedHandleChanges({
			owner: this,
			changeTracker: {
				createChangeSummary: () => ({ didUndo: false }),
				handleChange: (ctx, changeSummary) => {
					changeSummary.didUndo = ctx.didChange(this._textModelVersionId) && !!ctx.change?.isUndoing;
					return true;
				}
			}
		}, (reader, changeSummary) => {
			const versionId = this._textModelVersionId.read(reader);
			if (versionId !== null
				&& this._lastAcceptedInlineCompletionInfo
				&& this._lastAcceptedInlineCompletionInfo.textModelVersionIdAfter === versionId - 1
				&& this._lastAcceptedInlineCompletionInfo.inlineCompletion.isInlineEdit
				&& changeSummary.didUndo
			) {
				this._lastAcceptedInlineCompletionInfo = undefined;
				return true;
			}
			return false;
		});
		this._preserveCurrentCompletionReasons = new Set([
			VersionIdChangeReason.Redo,
			VersionIdChangeReason.Undo,
			VersionIdChangeReason.AcceptWord,
		]);
		this.dontRefetchSignal = observableSignal(this);
		this._fetchInlineCompletionsPromise = derivedHandleChanges({
			owner: this,
			changeTracker: {
				createChangeSummary: () => ({
					dontRefetch: false,
					preserveCurrentCompletion: false,
					inlineCompletionTriggerKind: InlineCompletionTriggerKind.Automatic,
					onlyRequestInlineEdits: false,
					shouldDebounce: true,
					provider: undefined as InlineCompletionsProvider | undefined,
					textChange: false,
					changeReason: '',
				}),
				handleChange: (ctx, changeSummary) => {
					/** @description fetch inline completions */
					if (ctx.didChange(this._textModelVersionId)) {
						if (this._preserveCurrentCompletionReasons.has(this._getReason(ctx.change))) {
							changeSummary.preserveCurrentCompletion = true;
						}
						const detailedReasons = ctx.change?.detailedReasons ?? [];
						changeSummary.changeReason = detailedReasons.length > 0 ? detailedReasons[0].getType() : '';
						changeSummary.textChange = true;
					} else if (ctx.didChange(this._forceUpdateExplicitlySignal)) {
						changeSummary.preserveCurrentCompletion = true;
						changeSummary.inlineCompletionTriggerKind = InlineCompletionTriggerKind.Explicit;
					} else if (ctx.didChange(this.dontRefetchSignal)) {
						changeSummary.dontRefetch = true;
					} else if (ctx.didChange(this._onlyRequestInlineEditsSignal)) {
						changeSummary.onlyRequestInlineEdits = true;
					} else if (ctx.didChange(this._fetchSpecificProviderSignal)) {
						changeSummary.provider = ctx.change;
					}
					return true;
				},
			},
		}, (reader, changeSummary) => {
			this._source.clearOperationOnTextModelChange.read(reader); // Make sure the clear operation runs before the fetch operation
			this._noDelaySignal.read(reader);
			this.dontRefetchSignal.read(reader);
			this._onlyRequestInlineEditsSignal.read(reader);
			this._forceUpdateExplicitlySignal.read(reader);
			this._fetchSpecificProviderSignal.read(reader);
			const shouldUpdate = ((this._enabled.read(reader) && this._selectedSuggestItem.read(reader)) || this._isActive.read(reader))
				&& (!inlineCompletionsService.isSnoozing() || changeSummary.inlineCompletionTriggerKind === InlineCompletionTriggerKind.Explicit);
			if (!shouldUpdate) {
				this._source.cancelUpdate();
				return undefined;
			}

			this._textModelVersionId.read(reader); // Refetch on text change

			const suggestWidgetInlineCompletions = this._source.suggestWidgetInlineCompletions.get();
			const suggestItem = this._selectedSuggestItem.read(reader);
			if (suggestWidgetInlineCompletions && !suggestItem) {
				this._source.seedInlineCompletionsWithSuggestWidget();
			}

			if (changeSummary.dontRefetch) {
				return Promise.resolve(true);
			}

			if (this._didUndoInlineEdits.read(reader) && changeSummary.inlineCompletionTriggerKind !== InlineCompletionTriggerKind.Explicit) {
				transaction(tx => {
					this._source.clear(tx);
				});
				return undefined;
			}

			let reason: string = '';
			if (changeSummary.provider) {
				reason += 'providerOnDidChange';
			} else if (changeSummary.inlineCompletionTriggerKind === InlineCompletionTriggerKind.Explicit) {
				reason += 'explicit';
			}
			if (changeSummary.changeReason) {
				reason += reason.length > 0 ? `:${changeSummary.changeReason}` : changeSummary.changeReason;
			}

			const requestInfo: InlineSuggestRequestInfo = {
				editorType: this.editorType,
				startTime: Date.now(),
				languageId: this.textModel.getLanguageId(),
				reason,
			};

			let context: InlineCompletionContextWithoutUuid = {
				triggerKind: changeSummary.inlineCompletionTriggerKind,
				selectedSuggestionInfo: suggestItem?.toSelectedSuggestionInfo(),
				includeInlineCompletions: !changeSummary.onlyRequestInlineEdits,
				includeInlineEdits: this._inlineEditsEnabled.read(reader),
			};

			if (context.triggerKind === InlineCompletionTriggerKind.Automatic && changeSummary.textChange) {
				if (this.textModel.getAlternativeVersionId() === this._lastShownInlineCompletionInfo?.alternateTextModelVersionId) {
					// When undoing back to a version where an inline edit/completion was shown,
					// we want to show an inline edit (or completion) again if it was originally an inline edit (or completion).
					context = {
						...context,
						includeInlineCompletions: !this._lastShownInlineCompletionInfo.inlineCompletion.isInlineEdit,
						includeInlineEdits: this._lastShownInlineCompletionInfo.inlineCompletion.isInlineEdit,
					};
				}
			}

			const itemToPreserveCandidate = this.selectedInlineCompletion.get() ?? this._inlineCompletionItems.get()?.inlineEdit;
			const itemToPreserve = changeSummary.preserveCurrentCompletion || itemToPreserveCandidate?.forwardStable
				? itemToPreserveCandidate : undefined;
			const userJumpedToActiveCompletion = this._jumpedToId.map(jumpedTo => !!jumpedTo && jumpedTo === this._inlineCompletionItems.get()?.inlineEdit?.semanticId);

			const providers = changeSummary.provider ? [changeSummary.provider] : this._languageFeaturesService.inlineCompletionsProvider.all(this.textModel);
			const suppressedProviderGroupIds = this._suppressedInlineCompletionGroupIds.get();
			const availableProviders = providers.filter(provider => !(provider.groupId && suppressedProviderGroupIds.has(provider.groupId)));

			return this._source.fetch(availableProviders, context, itemToPreserve?.identity, changeSummary.shouldDebounce, userJumpedToActiveCompletion, !!changeSummary.provider, requestInfo);
		});

		this._inlineCompletionItems = derivedOpts({ owner: this }, reader => {
			const c = this._source.inlineCompletions.read(reader);
			if (!c) { return undefined; }
			const cursorPosition = this.primaryPosition.read(reader);
			let inlineEdit: InlineEditItem | undefined = undefined;
			const visibleCompletions: InlineCompletionItem[] = [];
			for (const completion of c.inlineCompletions) {
				if (!completion.isInlineEdit) {
					if (completion.isVisible(this.textModel, cursorPosition)) {
						visibleCompletions.push(completion);
					}
				} else {
					inlineEdit = completion;
				}
			}

			if (visibleCompletions.length !== 0) {
				// Don't show the inline edit if there is a visible completion
				inlineEdit = undefined;
			}

			return {
				inlineCompletions: visibleCompletions,
				inlineEdit,
			};
		});
		this._filteredInlineCompletionItems = derivedOpts({ owner: this, equalsFn: itemsEquals() }, reader => {
			const c = this._inlineCompletionItems.read(reader);
			return c?.inlineCompletions ?? [];
		});
		this.selectedInlineCompletionIndex = derived<number>(this, (reader) => {
			const selectedInlineCompletionId = this._selectedInlineCompletionId.read(reader);
			const filteredCompletions = this._filteredInlineCompletionItems.read(reader);
			const idx = this._selectedInlineCompletionId === undefined ? -1
				: filteredCompletions.findIndex(v => v.semanticId === selectedInlineCompletionId);
			if (idx === -1) {
				// Reset the selection so that the selection does not jump back when it appears again
				this._selectedInlineCompletionId.set(undefined, undefined);
				return 0;
			}
			return idx;
		});
		this.selectedInlineCompletion = derived<InlineCompletionItem | undefined>(this, (reader) => {
			const filteredCompletions = this._filteredInlineCompletionItems.read(reader);
			const idx = this.selectedInlineCompletionIndex.read(reader);
			return filteredCompletions[idx];
		});
		this.activeCommands = derivedOpts<InlineCompletionCommand[]>({ owner: this, equalsFn: itemsEquals() },
			r => this.selectedInlineCompletion.read(r)?.source.inlineSuggestions.commands ?? []
		);
		this.lastTriggerKind = this._source.inlineCompletions.map(this, v => v?.request?.context.triggerKind);
		this.inlineCompletionsCount = derived<number | undefined>(this, reader => {
			if (this.lastTriggerKind.read(reader) === InlineCompletionTriggerKind.Explicit) {
				return this._filteredInlineCompletionItems.read(reader).length;
			} else {
				return undefined;
			}
		});
		this._hasVisiblePeekWidgets = derived(this, reader => this._editorObs.openedPeekWidgets.read(reader) > 0);
		this.state = derivedOpts<{
			kind: 'ghostText';
			edits: readonly TextReplacement[];
			primaryGhostText: GhostTextOrReplacement;
			ghostTexts: readonly GhostTextOrReplacement[];
			suggestItem: SuggestItemInfo | undefined;
			inlineCompletion: InlineCompletionItem | undefined;
		} | {
			kind: 'inlineEdit';
			edits: readonly TextReplacement[];
			inlineEdit: InlineEdit;
			inlineCompletion: InlineEditItem;
			cursorAtInlineEdit: IObservable<boolean>;
		} | undefined>({
			owner: this,
			equalsFn: (a, b) => {
				if (!a || !b) { return a === b; }

				if (a.kind === 'ghostText' && b.kind === 'ghostText') {
					return ghostTextsOrReplacementsEqual(a.ghostTexts, b.ghostTexts)
						&& a.inlineCompletion === b.inlineCompletion
						&& a.suggestItem === b.suggestItem;
				} else if (a.kind === 'inlineEdit' && b.kind === 'inlineEdit') {
					return a.inlineEdit.equals(b.inlineEdit);
				}
				return false;
			}
		}, (reader) => {
			const model = this.textModel;

			const item = this._inlineCompletionItems.read(reader);
			const inlineEditResult = item?.inlineEdit;
			if (inlineEditResult) {
				if (this._hasVisiblePeekWidgets.read(reader)) {
					return undefined;
				}
				let edit = inlineEditResult.getSingleTextEdit();
				edit = singleTextRemoveCommonPrefix(edit, model);

				const cursorAtInlineEdit = this.primaryPosition.map(cursorPos => LineRange.fromRangeInclusive(inlineEditResult.targetRange).addMargin(1, 1).contains(cursorPos.lineNumber));

				const commands = inlineEditResult.source.inlineSuggestions.commands;
				const inlineEdit = new InlineEdit(edit, commands ?? [], inlineEditResult);

				const edits = inlineEditResult.updatedEdit;
				const e = edits ? TextEdit.fromStringEdit(edits, new TextModelText(this.textModel)).replacements : [edit];

				return { kind: 'inlineEdit', inlineEdit, inlineCompletion: inlineEditResult, edits: e, cursorAtInlineEdit };
			}

			const suggestItem = this._selectedSuggestItem.read(reader);
			if (suggestItem) {
				const suggestCompletionEdit = singleTextRemoveCommonPrefix(suggestItem.getSingleTextEdit(), model);
				const augmentation = this._computeAugmentation(suggestCompletionEdit, reader);

				const isSuggestionPreviewEnabled = this._suggestPreviewEnabled.read(reader);
				if (!isSuggestionPreviewEnabled && !augmentation) { return undefined; }

				const fullEdit = augmentation?.edit ?? suggestCompletionEdit;
				const fullEditPreviewLength = augmentation ? augmentation.edit.text.length - suggestCompletionEdit.text.length : 0;

				const mode = this._suggestPreviewMode.read(reader);
				const positions = this._positions.read(reader);
				const edits = [fullEdit, ...getSecondaryEdits(this.textModel, positions, fullEdit)];
				const ghostTexts = edits
					.map((edit, idx) => computeGhostText(edit, model, mode, positions[idx], fullEditPreviewLength))
					.filter(isDefined);
				const primaryGhostText = ghostTexts[0] ?? new GhostText(fullEdit.range.endLineNumber, []);
				return { kind: 'ghostText', edits, primaryGhostText, ghostTexts, inlineCompletion: augmentation?.completion, suggestItem };
			} else {
				if (!this._isActive.read(reader)) { return undefined; }
				const inlineCompletion = this.selectedInlineCompletion.read(reader);
				if (!inlineCompletion) { return undefined; }

				const replacement = inlineCompletion.getSingleTextEdit();
				const mode = this._inlineSuggestMode.read(reader);
				const positions = this._positions.read(reader);
				const edits = [replacement, ...getSecondaryEdits(this.textModel, positions, replacement)];
				const ghostTexts = edits
					.map((edit, idx) => computeGhostText(edit, model, mode, positions[idx], 0))
					.filter(isDefined);
				if (!ghostTexts[0]) { return undefined; }
				return { kind: 'ghostText', edits, primaryGhostText: ghostTexts[0], ghostTexts, inlineCompletion, suggestItem: undefined };
			}
		});
		this.status = derived(this, reader => {
			if (this._source.loading.read(reader)) { return 'loading'; }
			const s = this.state.read(reader);
			if (s?.kind === 'ghostText') { return 'ghostText'; }
			if (s?.kind === 'inlineEdit') { return 'inlineEdit'; }
			return 'noSuggestion';
		});
		this.inlineCompletionState = derived(this, reader => {
			const s = this.state.read(reader);
			if (!s || s.kind !== 'ghostText') {
				return undefined;
			}
			if (this._editorObs.inComposition.read(reader)) {
				return undefined;
			}
			return s;
		});
		this.inlineEditState = derived(this, reader => {
			const s = this.state.read(reader);
			if (!s || s.kind !== 'inlineEdit') {
				return undefined;
			}
			return s;
		});
		this.inlineEditAvailable = derived(this, reader => {
			const s = this.inlineEditState.read(reader);
			return !!s;
		});
		this.warning = derived(this, reader => {
			return this.inlineCompletionState.read(reader)?.inlineCompletion?.warning;
		});
		this.ghostTexts = derivedOpts({ owner: this, equalsFn: ghostTextsOrReplacementsEqual }, reader => {
			const v = this.inlineCompletionState.read(reader);
			if (!v) {
				return undefined;
			}
			return v.ghostTexts;
		});
		this.primaryGhostText = derivedOpts({ owner: this, equalsFn: ghostTextOrReplacementEquals }, reader => {
			const v = this.inlineCompletionState.read(reader);
			if (!v) {
				return undefined;
			}
			return v?.primaryGhostText;
		});

		this._jumpedToId = observableValue<undefined | string>(this, undefined);
		this._inAcceptFlow = observableValue(this, false);
		this.inAcceptFlow = this._inAcceptFlow;

		// When the suggestion appeared, was it inside the view port or not
		const appearedInsideViewport = derived<boolean>(this, reader => {
			const state = this.state.read(reader);
			if (!state || !state.inlineCompletion) {
				return false;
			}

			const targetRange = state.inlineCompletion.targetRange;
			const visibleRanges = this._editorObs.editor.getVisibleRanges();
			if (visibleRanges.length < 1) {
				return false;
			}

			const viewportRange = new Range(visibleRanges[0].startLineNumber, visibleRanges[0].startColumn, visibleRanges[visibleRanges.length - 1].endLineNumber, visibleRanges[visibleRanges.length - 1].endColumn);
			return viewportRange.containsRange(targetRange);
		});

		this.showCollapsed = derived<boolean>(this, reader => {
			const state = this.state.read(reader);
			if (!state || state.kind !== 'inlineEdit') {
				return false;
			}

			if (state.inlineCompletion.displayLocation) {
				return false;
			}

			const isCurrentModelVersion = state.inlineCompletion.updatedEditModelVersion === this._textModelVersionId.read(reader);
			return (this._inlineEditsShowCollapsedEnabled.read(reader) || !isCurrentModelVersion)
				&& this._jumpedToId.read(reader) !== state.inlineCompletion.semanticId
				&& !this._inAcceptFlow.read(reader);
		});
		this._tabShouldIndent = derived(this, reader => {
			if (this._inAcceptFlow.read(reader)) {
				return false;
			}

			function isMultiLine(range: Range): boolean {
				return range.startLineNumber !== range.endLineNumber;
			}

			function getNonIndentationRange(model: ITextModel, lineNumber: number): Range {
				const columnStart = model.getLineIndentColumn(lineNumber);
				const lastNonWsColumn = model.getLineLastNonWhitespaceColumn(lineNumber);
				const columnEnd = Math.max(lastNonWsColumn, columnStart);
				return new Range(lineNumber, columnStart, lineNumber, columnEnd);
			}

			const selections = this._editorObs.selections.read(reader);
			return selections?.some(s => {
				if (s.isEmpty()) {
					return this.textModel.getLineLength(s.startLineNumber) === 0;
				} else {
					return isMultiLine(s) || s.containsRange(getNonIndentationRange(this.textModel, s.startLineNumber));
				}
			});
		});
		this.tabShouldJumpToInlineEdit = derived(this, reader => {
			if (this._tabShouldIndent.read(reader)) {
				return false;
			}

			const s = this.inlineEditState.read(reader);
			if (!s) {
				return false;
			}

			if (this.showCollapsed.read(reader)) {
				return true;
			}

			if (this._inAcceptFlow.read(reader) && appearedInsideViewport.read(reader)) {
				return false;
			}

			return !s.cursorAtInlineEdit.read(reader);
		});
		this.tabShouldAcceptInlineEdit = derived(this, reader => {
			const s = this.inlineEditState.read(reader);
			if (!s) {
				return false;
			}
			if (this.showCollapsed.read(reader)) {
				return false;
			}
			if (this._inAcceptFlow.read(reader) && appearedInsideViewport.read(reader)) {
				return true;
			}
			if (s.inlineCompletion.targetRange.startLineNumber === this._editorObs.cursorLineNumber.read(reader)) {
				return true;
			}
			if (this._jumpedToId.read(reader) === s.inlineCompletion.semanticId) {
				return true;
			}
			if (this._tabShouldIndent.read(reader)) {
				return false;
			}

			return s.cursorAtInlineEdit.read(reader);
		});

		{ // Determine editor type
			const [diffEditor] = this._codeEditorService.listDiffEditors()
				.filter(d =>
					d.getOriginalEditor().getId() === this._editor.getId() ||
					d.getModifiedEditor().getId() === this._editor.getId());

			this.editorType = !!diffEditor ? InlineCompletionEditorType.DiffEditor : InlineCompletionEditorType.TextEditor;
			this.isInDiffEditor = this.editorType === InlineCompletionEditorType.DiffEditor;
		}

		this._register(recomputeInitiallyAndOnChange(this._fetchInlineCompletionsPromise));

		this._register(autorun(reader => {
			this._editorObs.versionId.read(reader);
			this._inAcceptFlow.set(false, undefined);
		}));

		this._register(autorun(reader => {
			const jumpToReset = this.state.map((s, reader) => !s || s.kind === 'inlineEdit' && !s.cursorAtInlineEdit.read(reader)).read(reader);
			if (jumpToReset) {
				this._jumpedToId.set(undefined, undefined);
			}
		}));

		const inlineEditSemanticId = this.inlineEditState.map(s => s?.inlineCompletion.semanticId);

		this._register(autorun(reader => {
			const id = inlineEditSemanticId.read(reader);
			if (id) {
				this._editor.pushUndoStop();
				this._lastShownInlineCompletionInfo = {
					alternateTextModelVersionId: this.textModel.getAlternativeVersionId(),
					inlineCompletion: this.state.get()!.inlineCompletion!,
				};
			}
		}));

		const inlineCompletionProviders = observableFromEvent(this._languageFeaturesService.inlineCompletionsProvider.onDidChange, () => this._languageFeaturesService.inlineCompletionsProvider.all(textModel));
		mapObservableArrayCached(this, inlineCompletionProviders, (provider, store) => {
			if (!provider.onDidChangeInlineCompletions) {
				return;
			}

			store.add(provider.onDidChangeInlineCompletions(() => {
				if (!this._enabled.get()) {
					return;
				}

				// Only update the active editor
				const activeEditor = this._codeEditorService.getFocusedCodeEditor() || this._codeEditorService.getActiveCodeEditor();
				if (activeEditor !== this._editor) {
					return;
				}

				if (this._triggerCommandOnProviderChange.get()) {
					// TODO@hediet remove this and always do the else branch.
					this.trigger(undefined, { onlyFetchInlineEdits: true });
					return;
				}


				// If there is an active suggestion from a different provider, we ignore the update
				const activeState = this.state.get();
				if (activeState && (activeState.inlineCompletion || activeState.edits) && activeState.inlineCompletion?.source.provider !== provider) {
					return;
				}

				transaction(tx => {
					this._fetchSpecificProviderSignal.trigger(tx, provider);
					this.trigger(tx);
				});

			}));
		}).recomputeInitiallyAndOnChange(this._store);

		this._didUndoInlineEdits.recomputeInitiallyAndOnChange(this._store);
	}

	private _lastShownInlineCompletionInfo: { alternateTextModelVersionId: number; /* already freed! */ inlineCompletion: InlineSuggestionItem } | undefined;
	private _lastAcceptedInlineCompletionInfo: { textModelVersionIdAfter: number; /* already freed! */ inlineCompletion: InlineSuggestionItem } | undefined;
	private readonly _didUndoInlineEdits;

	public debugGetSelectedSuggestItem(): IObservable<SuggestItemInfo | undefined> {
		return this._selectedSuggestItem;
	}

	public getIndentationInfo(reader: IReader) {
		let startsWithIndentation = false;
		let startsWithIndentationLessThanTabSize = true;
		const ghostText = this?.primaryGhostText.read(reader);
		if (!!this?._selectedSuggestItem && ghostText && ghostText.parts.length > 0) {
			const { column, lines } = ghostText.parts[0];

			const firstLine = lines[0].line;

			const indentationEndColumn = this.textModel.getLineIndentColumn(ghostText.lineNumber);
			const inIndentation = column <= indentationEndColumn;

			if (inIndentation) {
				let firstNonWsIdx = firstNonWhitespaceIndex(firstLine);
				if (firstNonWsIdx === -1) {
					firstNonWsIdx = firstLine.length - 1;
				}
				startsWithIndentation = firstNonWsIdx > 0;

				const tabSize = this.textModel.getOptions().tabSize;
				const visibleColumnIndentation = CursorColumns.visibleColumnFromColumn(firstLine, firstNonWsIdx + 1, tabSize);
				startsWithIndentationLessThanTabSize = visibleColumnIndentation < tabSize;
			}
		}
		return {
			startsWithIndentation,
			startsWithIndentationLessThanTabSize,
		};
	}

	private readonly _preserveCurrentCompletionReasons;

	private _getReason(e: IModelContentChangedEvent | undefined): VersionIdChangeReason {
		if (e?.isUndoing) { return VersionIdChangeReason.Undo; }
		if (e?.isRedoing) { return VersionIdChangeReason.Redo; }
		if (this.isAcceptingPartially) { return VersionIdChangeReason.AcceptWord; }
		return VersionIdChangeReason.Other;
	}

	public readonly dontRefetchSignal;

	private readonly _fetchInlineCompletionsPromise;

	public async trigger(tx?: ITransaction, options?: { onlyFetchInlineEdits?: boolean; noDelay?: boolean }): Promise<void> {
		subtransaction(tx, tx => {
			if (options?.onlyFetchInlineEdits) {
				this._onlyRequestInlineEditsSignal.trigger(tx);
			}
			if (options?.noDelay) {
				this._noDelaySignal.trigger(tx);
			}
			this._isActive.set(true, tx);
		});
		await this._fetchInlineCompletionsPromise.get();
	}

	public async triggerExplicitly(tx?: ITransaction, onlyFetchInlineEdits: boolean = false): Promise<void> {
		subtransaction(tx, tx => {
			if (onlyFetchInlineEdits) {
				this._onlyRequestInlineEditsSignal.trigger(tx);
			}
			this._isActive.set(true, tx);
			this._inAcceptFlow.set(true, tx);
			this._forceUpdateExplicitlySignal.trigger(tx);
		});
		await this._fetchInlineCompletionsPromise.get();
	}

	public stop(stopReason: 'explicitCancel' | 'automatic' = 'automatic', tx?: ITransaction): void {
		subtransaction(tx, tx => {
			if (stopReason === 'explicitCancel') {
				const inlineCompletion = this.state.get()?.inlineCompletion;
				if (inlineCompletion) {
					inlineCompletion.reportEndOfLife({ kind: InlineCompletionEndOfLifeReasonKind.Rejected });
				}
			}

			this._isActive.set(false, tx);
			this._source.clear(tx);
		});
	}

	private readonly _inlineCompletionItems;

	private readonly _filteredInlineCompletionItems;

	public readonly selectedInlineCompletionIndex;

	public readonly selectedInlineCompletion;

	public readonly activeCommands;

	public readonly lastTriggerKind: IObservable<InlineCompletionTriggerKind | undefined>
		;

	public readonly inlineCompletionsCount;

	private readonly _hasVisiblePeekWidgets;

	public readonly state;

	public readonly status;

	public readonly inlineCompletionState;

	public readonly inlineEditState;

	public readonly inlineEditAvailable;

	private _computeAugmentation(suggestCompletion: TextReplacement, reader: IReader | undefined) {
		const model = this.textModel;
		const suggestWidgetInlineCompletions = this._source.suggestWidgetInlineCompletions.read(reader);
		const candidateInlineCompletions = suggestWidgetInlineCompletions
			? suggestWidgetInlineCompletions.inlineCompletions.filter(c => !c.isInlineEdit)
			: [this.selectedInlineCompletion.read(reader)].filter(isDefined);

		const augmentedCompletion = mapFindFirst(candidateInlineCompletions, completion => {
			let r = completion.getSingleTextEdit();
			r = singleTextRemoveCommonPrefix(
				r,
				model,
				Range.fromPositions(r.range.getStartPosition(), suggestCompletion.range.getEndPosition())
			);
			return singleTextEditAugments(r, suggestCompletion) ? { completion, edit: r } : undefined;
		});

		return augmentedCompletion;
	}

	public readonly warning;

	public readonly ghostTexts;

	public readonly primaryGhostText;

	public readonly showCollapsed;

	private readonly _tabShouldIndent;

	public readonly tabShouldJumpToInlineEdit;

	public readonly tabShouldAcceptInlineEdit;

	public readonly isInDiffEditor;

	public readonly editorType: InlineCompletionEditorType;

	private async _deltaSelectedInlineCompletionIndex(delta: 1 | -1): Promise<void> {
		await this.triggerExplicitly();

		const completions = this._filteredInlineCompletionItems.get() || [];
		if (completions.length > 0) {
			const newIdx = (this.selectedInlineCompletionIndex.get() + delta + completions.length) % completions.length;
			this._selectedInlineCompletionId.set(completions[newIdx].semanticId, undefined);
		} else {
			this._selectedInlineCompletionId.set(undefined, undefined);
		}
	}

	public async next(): Promise<void> { await this._deltaSelectedInlineCompletionIndex(1); }

	public async previous(): Promise<void> { await this._deltaSelectedInlineCompletionIndex(-1); }

	private _getMetadata(completion: InlineSuggestionItem, type: 'word' | 'line' | undefined = undefined): TextModelEditReason {
		if (type) {
			return EditReasons.inlineCompletionPartialAccept({
				nes: completion.isInlineEdit,
				requestUuid: completion.requestUuid,
				extensionId: completion.source.provider.groupId ?? 'unknown',
				type,
			});
		} else {
			return EditReasons.inlineCompletionAccept({
				nes: completion.isInlineEdit,
				requestUuid: completion.requestUuid,
				extensionId: completion.source.provider.groupId ?? 'unknown',
			});
		}
	}

	public async accept(editor: ICodeEditor = this._editor): Promise<void> {
		if (editor.getModel() !== this.textModel) {
			throw new BugIndicatingError();
		}

		let completion: InlineSuggestionItem;

		const state = this.state.get();
		if (state?.kind === 'ghostText') {
			if (!state || state.primaryGhostText.isEmpty() || !state.inlineCompletion) {
				return;
			}
			completion = state.inlineCompletion;
		} else if (state?.kind === 'inlineEdit') {
			completion = state.inlineCompletion;
		} else {
			return;
		}

		// Make sure the completion list will not be disposed before the text change is sent.
		completion.addRef();

		try {
			editor.pushUndoStop();
			if (completion.snippetInfo) {
				const mainEdit = TextReplacement.delete(completion.editRange);
				const additionalEdits = completion.additionalTextEdits.map(e => new TextReplacement(Range.lift(e.range), e.text ?? ''));
				const edit = TextEdit.fromParallelReplacementsUnsorted([mainEdit, ...additionalEdits]);
				editor.edit(edit, this._getMetadata(completion));

				editor.setPosition(completion.snippetInfo.range.getStartPosition(), 'inlineCompletionAccept');
				SnippetController2.get(editor)?.insert(completion.snippetInfo.snippet, { undoStopBefore: false });
			} else {
				const edits = state.edits;

				// The cursor should move to the end of the edit, not the end of the range provided by the extension
				// Inline Edit diffs (human readable) the suggestion from the extension so it already removes common suffix/prefix
				// Inline Completions does diff the suggestion so it may contain common suffix
				let minimalEdits = edits;
				if (state.kind === 'ghostText') {
					minimalEdits = removeTextReplacementCommonSuffixPrefix(edits, this.textModel);
				}
				const selections = getEndPositionsAfterApplying(minimalEdits).map(p => Selection.fromPositions(p));

				const additionalEdits = completion.additionalTextEdits.map(e => new TextReplacement(Range.lift(e.range), e.text ?? ''));
				const edit = TextEdit.fromParallelReplacementsUnsorted([...edits, ...additionalEdits]);

				editor.edit(edit, this._getMetadata(completion));

				if (completion.displayLocation === undefined) {
					// do not move the cursor when the completion is displayed in a different location
					editor.setSelections(state.kind === 'inlineEdit' ? selections.slice(-1) : selections, 'inlineCompletionAccept');
				}

				if (state.kind === 'inlineEdit' && !this._accessibilityService.isMotionReduced()) {
					const editRanges = edit.getNewRanges();
					const dec = this._store.add(new FadeoutDecoration(editor, editRanges, () => {
						this._store.delete(dec);
					}));
				}
			}

			this._onDidAccept.fire();

			// Reset before invoking the command, as the command might cause a follow up trigger (which we don't want to reset).
			this.stop();

			if (completion.command) {
				await this._commandService
					.executeCommand(completion.command.id, ...(completion.command.arguments || []))
					.then(undefined, onUnexpectedExternalError);
			}

			completion.reportEndOfLife({ kind: InlineCompletionEndOfLifeReasonKind.Accepted });
		} finally {
			completion.removeRef();
			this._inAcceptFlow.set(true, undefined);
			this._lastAcceptedInlineCompletionInfo = { textModelVersionIdAfter: this.textModel.getVersionId(), inlineCompletion: completion };
		}
	}

	public async acceptNextWord(): Promise<void> {
		await this._acceptNext(this._editor, 'word', (pos, text) => {
			const langId = this.textModel.getLanguageIdAtPosition(pos.lineNumber, pos.column);
			const config = this._languageConfigurationService.getLanguageConfiguration(langId);
			const wordRegExp = new RegExp(config.wordDefinition.source, config.wordDefinition.flags.replace('g', ''));

			const m1 = text.match(wordRegExp);
			let acceptUntilIndexExclusive = 0;
			if (m1 && m1.index !== undefined) {
				if (m1.index === 0) {
					acceptUntilIndexExclusive = m1[0].length;
				} else {
					acceptUntilIndexExclusive = m1.index;
				}
			} else {
				acceptUntilIndexExclusive = text.length;
			}

			const wsRegExp = /\s+/g;
			const m2 = wsRegExp.exec(text);
			if (m2 && m2.index !== undefined) {
				if (m2.index + m2[0].length < acceptUntilIndexExclusive) {
					acceptUntilIndexExclusive = m2.index + m2[0].length;
				}
			}
			return acceptUntilIndexExclusive;
		}, PartialAcceptTriggerKind.Word);
	}

	public async acceptNextLine(): Promise<void> {
		await this._acceptNext(this._editor, 'line', (pos, text) => {
			const m = text.match(/\n/);
			if (m && m.index !== undefined) {
				return m.index + 1;
			}
			return text.length;
		}, PartialAcceptTriggerKind.Line);
	}

	private async _acceptNext(editor: ICodeEditor, type: 'word' | 'line', getAcceptUntilIndex: (position: Position, text: string) => number, kind: PartialAcceptTriggerKind): Promise<void> {
		if (editor.getModel() !== this.textModel) {
			throw new BugIndicatingError();
		}

		const state = this.inlineCompletionState.get();
		if (!state || state.primaryGhostText.isEmpty() || !state.inlineCompletion) {
			return;
		}
		const ghostText = state.primaryGhostText;
		const completion = state.inlineCompletion;

		if (completion.snippetInfo) {
			// not in WYSIWYG mode, partial commit might change completion, thus it is not supported
			await this.accept(editor);
			return;
		}

		const firstPart = ghostText.parts[0];
		const ghostTextPos = new Position(ghostText.lineNumber, firstPart.column);
		const ghostTextVal = firstPart.text;
		const acceptUntilIndexExclusive = getAcceptUntilIndex(ghostTextPos, ghostTextVal);
		if (acceptUntilIndexExclusive === ghostTextVal.length && ghostText.parts.length === 1) {
			this.accept(editor);
			return;
		}
		const partialGhostTextVal = ghostTextVal.substring(0, acceptUntilIndexExclusive);

		const positions = this._positions.get();
		const cursorPosition = positions[0];

		// Executing the edit might free the completion, so we have to hold a reference on it.
		completion.addRef();
		try {
			this._isAcceptingPartially = true;
			try {
				editor.pushUndoStop();
				const replaceRange = Range.fromPositions(cursorPosition, ghostTextPos);
				const newText = editor.getModel()!.getValueInRange(replaceRange) + partialGhostTextVal;
				const primaryEdit = new TextReplacement(replaceRange, newText);
				const edits = [primaryEdit, ...getSecondaryEdits(this.textModel, positions, primaryEdit)];
				const selections = getEndPositionsAfterApplying(edits).map(p => Selection.fromPositions(p));

				editor.edit(TextEdit.fromParallelReplacementsUnsorted(edits), this._getMetadata(completion, type));
				editor.setSelections(selections, 'inlineCompletionPartialAccept');
				editor.revealPositionInCenterIfOutsideViewport(editor.getPosition()!, ScrollType.Immediate);
			} finally {
				this._isAcceptingPartially = false;
			}

			const acceptedRange = Range.fromPositions(completion.editRange.getStartPosition(), TextLength.ofText(partialGhostTextVal).addToPosition(ghostTextPos));
			// This assumes that the inline completion and the model use the same EOL style.
			const text = editor.getModel()!.getValueInRange(acceptedRange, EndOfLinePreference.LF);
			const acceptedLength = text.length;
			completion.reportPartialAccept(acceptedLength, { kind, acceptedLength: acceptedLength });

		} finally {
			completion.removeRef();
		}
	}

	public handleSuggestAccepted(item: SuggestItemInfo) {
		const itemEdit = singleTextRemoveCommonPrefix(item.getSingleTextEdit(), this.textModel);
		const augmentedCompletion = this._computeAugmentation(itemEdit, undefined);
		if (!augmentedCompletion) { return; }

		// This assumes that the inline completion and the model use the same EOL style.
		const alreadyAcceptedLength = this.textModel.getValueInRange(augmentedCompletion.completion.editRange, EndOfLinePreference.LF).length;
		const acceptedLength = alreadyAcceptedLength + itemEdit.text.length;

		augmentedCompletion.completion.reportPartialAccept(itemEdit.text.length, {
			kind: PartialAcceptTriggerKind.Suggest,
			acceptedLength,
		});
	}

	public extractReproSample(): Repro {
		const value = this.textModel.getValue();
		const item = this.state.get()?.inlineCompletion;
		return {
			documentValue: value,
			inlineCompletion: item?.getSourceCompletion(),
		};
	}

	private readonly _jumpedToId;
	private readonly _inAcceptFlow;
	public readonly inAcceptFlow: IObservable<boolean>;

	public jump(): void {
		const s = this.inlineEditState.get();
		if (!s) { return; }

		transaction(tx => {
			this._jumpedToId.set(s.inlineCompletion.semanticId, tx);
			this.dontRefetchSignal.trigger(tx);
			const targetRange = s.inlineCompletion.targetRange;
			const targetPosition = targetRange.getStartPosition();
			this._editor.setPosition(targetPosition, 'inlineCompletions.jump');

			// TODO: consider using view information to reveal it
			const isSingleLineChange = targetRange.isSingleLine() && (s.inlineCompletion.displayLocation || !s.inlineCompletion.insertText.includes('\n'));
			if (isSingleLineChange) {
				this._editor.revealPosition(targetPosition);
			} else {
				const revealRange = new Range(targetRange.startLineNumber - 1, 1, targetRange.endLineNumber + 1, 1);
				this._editor.revealRange(revealRange, ScrollType.Immediate);
			}

			this._editor.focus();
		});
	}

	public async handleInlineSuggestionShown(inlineCompletion: InlineSuggestionItem, viewKind: InlineCompletionViewKind, viewData: InlineCompletionViewData): Promise<void> {
		await inlineCompletion.reportInlineEditShown(this._commandService, viewKind, viewData);
	}
}

interface Repro {
	documentValue: string;
	inlineCompletion: InlineCompletion | undefined;
}

export enum VersionIdChangeReason {
	Undo,
	Redo,
	AcceptWord,
	Other,
}

export function getSecondaryEdits(textModel: ITextModel, positions: readonly Position[], primaryEdit: TextReplacement): TextReplacement[] {
	if (positions.length === 1) {
		// No secondary cursor positions
		return [];
	}
	const primaryPosition = positions[0];
	const secondaryPositions = positions.slice(1);
	const primaryEditStartPosition = primaryEdit.range.getStartPosition();
	const primaryEditEndPosition = primaryEdit.range.getEndPosition();
	const replacedTextAfterPrimaryCursor = textModel.getValueInRange(
		Range.fromPositions(primaryPosition, primaryEditEndPosition)
	);
	const positionWithinTextEdit = subtractPositions(primaryPosition, primaryEditStartPosition);
	if (positionWithinTextEdit.lineNumber < 1) {
		onUnexpectedError(new BugIndicatingError(
			`positionWithinTextEdit line number should be bigger than 0.
			Invalid subtraction between ${primaryPosition.toString()} and ${primaryEditStartPosition.toString()}`
		));
		return [];
	}
	const secondaryEditText = substringPos(primaryEdit.text, positionWithinTextEdit);
	return secondaryPositions.map(pos => {
		const posEnd = addPositions(subtractPositions(pos, primaryEditStartPosition), primaryEditEndPosition);
		const textAfterSecondaryCursor = textModel.getValueInRange(
			Range.fromPositions(pos, posEnd)
		);
		const l = commonPrefixLength(replacedTextAfterPrimaryCursor, textAfterSecondaryCursor);
		const range = Range.fromPositions(pos, pos.delta(0, l));
		return new TextReplacement(range, secondaryEditText);
	});
}

class FadeoutDecoration extends Disposable {
	constructor(
		editor: ICodeEditor,
		ranges: Range[],
		onDispose?: () => void,
	) {
		super();

		if (onDispose) {
			this._register({ dispose: () => onDispose() });
		}

		this._register(observableCodeEditor(editor).setDecorations(constObservable(ranges.map<IModelDeltaDecoration>(range => ({
			range: range,
			options: {
				description: 'animation',
				className: 'edits-fadeout-decoration',
				zIndex: 1,
			}
		})))));

		const animation = new AnimatedValue(1, 0, 1000, easeOutCubic);
		const val = new ObservableAnimatedValue(animation);

		this._register(autorun(reader => {
			const opacity = val.getValue(reader);
			editor.getContainerDomNode().style.setProperty('--animation-opacity', opacity.toString());
			if (animation.isFinished()) {
				this.dispose();
			}
		}));
	}
}
