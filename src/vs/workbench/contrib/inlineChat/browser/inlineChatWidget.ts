/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, getActiveElement, getTotalHeight, h, reset, trackFocus } from 'vs/base/browser/dom';
import { renderLabelWithIcons } from 'vs/base/browser/ui/iconLabel/iconLabels';
import { Emitter, Event } from 'vs/base/common/event';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, constObservable, derived, observableValue } from 'vs/base/common/observable';
import 'vs/css!./media/inlineChat';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { AccessibleDiffViewer, IAccessibleDiffViewerModel } from 'vs/editor/browser/widget/diffEditor/components/accessibleDiffViewer';
import { EditorOption, IComputedEditorOptions } from 'vs/editor/common/config/editorOptions';
import { LineRange } from 'vs/editor/common/core/lineRange';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { DetailedLineRangeMapping, RangeMapping } from 'vs/editor/common/diff/rangeMapping';
import { ICodeEditorViewState, ScrollType } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { IResolvedTextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IWorkbenchButtonBarOptions, MenuWorkbenchButtonBar } from 'vs/platform/actions/browser/buttonbar';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from 'vs/platform/actions/browser/toolbar';
import { MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { asCssVariable, asCssVariableName, editorBackground, inputBackground } from 'vs/platform/theme/common/colorRegistry';
import { AccessibilityVerbositySettingId } from 'vs/workbench/contrib/accessibility/browser/accessibilityConfiguration';
import { IAccessibleViewService } from 'vs/platform/accessibility/browser/accessibleView';
import { AccessibilityCommandId } from 'vs/workbench/contrib/accessibility/common/accessibilityCommands';
import { ChatModel, IChatModel } from 'vs/workbench/contrib/chat/common/chatModel';
import { isResponseVM, isWelcomeVM } from 'vs/workbench/contrib/chat/common/chatViewModel';
import { HunkInformation, Session } from 'vs/workbench/contrib/inlineChat/browser/inlineChatSession';
import { CTX_INLINE_CHAT_FOCUSED, CTX_INLINE_CHAT_RESPONSE_FOCUSED, inlineChatBackground, InlineChatConfigKeys, inlineChatForeground } from 'vs/workbench/contrib/inlineChat/common/inlineChat';
import { ChatWidget, IChatWidgetLocationOptions } from 'vs/workbench/contrib/chat/browser/chatWidget';
import { chatRequestBackground } from 'vs/workbench/contrib/chat/common/chatColors';
import { Selection } from 'vs/editor/common/core/selection';
import { ChatAgentLocation } from 'vs/workbench/contrib/chat/common/chatAgents';
import { isNonEmptyArray, tail } from 'vs/base/common/arrays';
import { IChatService } from 'vs/workbench/contrib/chat/common/chatService';
import { getDefaultHoverDelegate } from 'vs/base/browser/ui/hover/hoverDelegateFactory';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IChatWidgetViewOptions } from 'vs/workbench/contrib/chat/browser/chat';
import { TextOnlyMenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';


export interface InlineChatWidgetViewState {
	editorViewState: ICodeEditorViewState;
	input: string;
	placeholder: string;
}

export interface IInlineChatWidgetConstructionOptions {

	/**
	 * The menu that rendered as button bar, use for accept, discard etc
	 */
	statusMenuId: MenuId | { menu: MenuId; options: IWorkbenchButtonBarOptions };

	/**
	 * The options for the chat widget
	 */
	chatWidgetViewOptions?: IChatWidgetViewOptions;
}

export interface IInlineChatMessage {
	message: IMarkdownString;
	requestId: string;
}

export interface IInlineChatMessageAppender {
	appendContent(fragment: string): void;
	cancel(): void;
	complete(): void;
}

export class InlineChatWidget {

	protected readonly _elements = h(
		'div.inline-chat@root',
		[
			h('div.chat-widget@chatWidget'),
			h('div.accessibleViewer@accessibleViewer'),
			h('div.status@status', [
				h('div.label.info.hidden@infoLabel'),
				h('div.actions.text-style.hidden@toolbar1'),
				h('div.actions.button-style.hidden@toolbar2'),
				h('div.label.status.hidden@statusLabel'),
			]),
		]
	);

	protected readonly _store = new DisposableStore();

	private readonly _defaultChatModel: ChatModel;
	private readonly _ctxInputEditorFocused: IContextKey<boolean>;
	private readonly _ctxResponseFocused: IContextKey<boolean>;

	private readonly _chatWidget: ChatWidget;

	protected readonly _onDidChangeHeight = this._store.add(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = Event.filter(this._onDidChangeHeight.event, _ => !this._isLayouting);

	private readonly _onDidChangeInput = this._store.add(new Emitter<this>());
	readonly onDidChangeInput: Event<this> = this._onDidChangeInput.event;

	private _isLayouting: boolean = false;

	readonly scopedContextKeyService: IContextKeyService;

	constructor(
		location: IChatWidgetLocationOptions,
		options: IInlineChatWidgetConstructionOptions,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAccessibleViewService private readonly _accessibleViewService: IAccessibleViewService,
		@ITextModelService protected readonly _textModelResolverService: ITextModelService,
		@IChatService private readonly _chatService: IChatService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		this.scopedContextKeyService = this._store.add(_contextKeyService.createScoped(this._elements.chatWidget));
		const scopedInstaService = _instantiationService.createChild(
			new ServiceCollection([
				IContextKeyService,
				this.scopedContextKeyService
			]),
			this._store
		);

		this._chatWidget = scopedInstaService.createInstance(
			ChatWidget,
			location,
			{ resource: true },
			{
				defaultElementHeight: 32,
				renderStyle: 'minimal',
				renderInputOnTop: false,
				renderFollowups: true,
				supportsFileReferences: _configurationService.getValue(`chat.experimental.variables.${location.location}`) === true,
				filter: item => !isWelcomeVM(item),
				...options.chatWidgetViewOptions
			},
			{
				listForeground: inlineChatForeground,
				listBackground: inlineChatBackground,
				inputEditorBackground: inputBackground,
				resultEditorBackground: editorBackground
			}
		);
		this._chatWidget.render(this._elements.chatWidget);
		this._elements.chatWidget.style.setProperty(asCssVariableName(chatRequestBackground), asCssVariable(inlineChatBackground));
		this._chatWidget.setVisible(true);
		this._store.add(this._chatWidget);

		const viewModelStore = this._store.add(new DisposableStore());
		this._store.add(this._chatWidget.onDidChangeViewModel(() => {
			viewModelStore.clear();
			const viewModel = this._chatWidget.viewModel;
			if (viewModel) {
				viewModelStore.add(viewModel.onDidChange(() => this._onDidChangeHeight.fire()));
			}
			this._onDidChangeHeight.fire();
		}));

		this._store.add(this.chatWidget.onDidChangeContentHeight(() => {
			this._onDidChangeHeight.fire();
		}));

		// context keys
		this._ctxResponseFocused = CTX_INLINE_CHAT_RESPONSE_FOCUSED.bindTo(this._contextKeyService);
		const tracker = this._store.add(trackFocus(this.domNode));
		this._store.add(tracker.onDidBlur(() => this._ctxResponseFocused.set(false)));
		this._store.add(tracker.onDidFocus(() => this._ctxResponseFocused.set(true)));

		this._ctxInputEditorFocused = CTX_INLINE_CHAT_FOCUSED.bindTo(_contextKeyService);
		this._store.add(this._chatWidget.inputEditor.onDidFocusEditorWidget(() => this._ctxInputEditorFocused.set(true)));
		this._store.add(this._chatWidget.inputEditor.onDidBlurEditorWidget(() => this._ctxInputEditorFocused.set(false)));

		const statusMenuId = options.statusMenuId instanceof MenuId ? options.statusMenuId : options.statusMenuId.menu;

		// TEXT-ONLY bar
		const statusToolbarMenu = scopedInstaService.createInstance(MenuWorkbenchToolBar, this._elements.toolbar1, statusMenuId, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			telemetrySource: options.chatWidgetViewOptions?.menus?.telemetrySource,
			actionViewItemProvider: action => action instanceof MenuItemAction ? this._instantiationService.createInstance(TextOnlyMenuEntryActionViewItem, action, { conversational: true }) : undefined,
			toolbarOptions: { primaryGroup: '0_main' },
			menuOptions: { renderShortTitle: true },
			label: true,
			icon: false
		});
		this._store.add(statusToolbarMenu.onDidChangeMenuItems(() => this._onDidChangeHeight.fire()));
		this._store.add(statusToolbarMenu);

		// BUTTON bar
		const statusMenuOptions = options.statusMenuId instanceof MenuId ? undefined : options.statusMenuId.options;
		const statusButtonBar = scopedInstaService.createInstance(MenuWorkbenchButtonBar, this._elements.toolbar2, statusMenuId, {
			toolbarOptions: { primaryGroup: '0_main' },
			telemetrySource: options.chatWidgetViewOptions?.menus?.telemetrySource,
			menuOptions: { renderShortTitle: true },
			...statusMenuOptions,
		});
		this._store.add(statusButtonBar.onDidChange(() => this._onDidChangeHeight.fire()));
		this._store.add(statusButtonBar);

		const toggleToolbar = () => this._elements.status.classList.toggle('text', this._configurationService.getValue(InlineChatConfigKeys.ExpTextButtons));
		this._store.add(this._configurationService.onDidChangeConfiguration(e => e.affectsConfiguration(InlineChatConfigKeys.ExpTextButtons) && toggleToolbar()));
		toggleToolbar();


		this._store.add(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AccessibilityVerbositySettingId.InlineChat)) {
				this._updateAriaLabel();
			}
		}));

		this._elements.root.tabIndex = 0;
		this._elements.statusLabel.tabIndex = 0;
		this._updateAriaLabel();

		// this._elements.status
		this._store.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this._elements.statusLabel, () => {
			return this._elements.statusLabel.dataset['title'];
		}));

		this._store.add(this._chatService.onDidPerformUserAction(e => {
			if (e.sessionId === this._chatWidget.viewModel?.model.sessionId && e.action.kind === 'vote') {
				this.updateStatus('Thank you for your feedback!', { resetAfter: 1250 });
			}
		}));

		// LEGACY - default chat model
		// this is only here for as long as we offer updateChatMessage
		this._defaultChatModel = this._store.add(this._instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Editor));
		this._defaultChatModel.startInitialize();
		this._defaultChatModel.initialize(undefined);
		this.setChatModel(this._defaultChatModel);
	}

	private _updateAriaLabel(): void {

		this._elements.root.ariaLabel = this._accessibleViewService.getOpenAriaHint(AccessibilityVerbositySettingId.InlineChat);

		if (this._accessibilityService.isScreenReaderOptimized()) {
			let label = defaultAriaLabel;
			if (this._configurationService.getValue<boolean>(AccessibilityVerbositySettingId.InlineChat)) {
				const kbLabel = this._keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp)?.getLabel();
				label = kbLabel
					? localize('inlineChat.accessibilityHelp', "Inline Chat Input, Use {0} for Inline Chat Accessibility Help.", kbLabel)
					: localize('inlineChat.accessibilityHelpNoKb', "Inline Chat Input, Run the Inline Chat Accessibility Help command for more information.");
			}
			this._chatWidget.inputEditor.updateOptions({ ariaLabel: label });
		}
	}

	dispose(): void {
		this._store.dispose();
	}

	get domNode(): HTMLElement {
		return this._elements.root;
	}

	get chatWidget(): ChatWidget {
		return this._chatWidget;
	}

	saveState() {
		this._chatWidget.saveState();
	}

	layout(widgetDim: Dimension) {
		this._isLayouting = true;
		try {
			this._doLayout(widgetDim);
		} finally {
			this._isLayouting = false;
		}
	}

	protected _doLayout(dimension: Dimension): void {
		const extraHeight = this._getExtraHeight();
		const statusHeight = getTotalHeight(this._elements.status);

		// console.log('ZONE#Widget#layout', { height: dimension.height, extraHeight, progressHeight, followUpsHeight, statusHeight, LIST: dimension.height - progressHeight - followUpsHeight - statusHeight - extraHeight });

		this._elements.root.style.height = `${dimension.height - extraHeight}px`;
		this._elements.root.style.width = `${dimension.width}px`;

		this._chatWidget.layout(
			dimension.height - statusHeight - extraHeight,
			dimension.width
		);
	}

	/**
	 * The content height of this widget is the size that would require no scrolling
	 */
	get contentHeight(): number {
		const data = {
			chatWidgetContentHeight: this._chatWidget.contentHeight,
			statusHeight: getTotalHeight(this._elements.status),
			extraHeight: this._getExtraHeight()
		};
		const result = data.chatWidgetContentHeight + data.statusHeight + data.extraHeight;
		return result;
	}

	get minHeight(): number {
		// The chat widget is variable height and supports scrolling. It should be
		// at least "maxWidgetHeight" high and at most the content height.

		let maxWidgetOutputHeight = 100;
		for (const item of this._chatWidget.viewModel?.getItems() ?? []) {
			if (isResponseVM(item) && item.response.value.some(r => r.kind === 'textEditGroup' && !r.state?.applied)) {
				maxWidgetOutputHeight = 270;
				break;
			}
		}

		let value = this.contentHeight;
		value -= this._chatWidget.contentHeight;
		value += Math.min(this._chatWidget.input.contentHeight + maxWidgetOutputHeight, this._chatWidget.contentHeight);
		return value;
	}

	protected _getExtraHeight(): number {
		return 4 /* padding */ + 2 /*border*/ + 4 /*shadow*/;
	}

	get value(): string {
		return this._chatWidget.getInput();
	}

	set value(value: string) {
		this._chatWidget.setInput(value);
	}


	selectAll(includeSlashCommand: boolean = true) {
		// DEBT@jrieken
		// REMOVE when agents are adopted
		let startColumn = 1;
		if (!includeSlashCommand) {
			const match = /^(\/\w+)\s*/.exec(this._chatWidget.inputEditor.getModel()!.getLineContent(1));
			if (match) {
				startColumn = match[1].length + 1;
			}
		}
		this._chatWidget.inputEditor.setSelection(new Selection(1, startColumn, Number.MAX_SAFE_INTEGER, 1));
	}

	set placeholder(value: string) {
		this._chatWidget.setInputPlaceholder(value);
	}

	updateToolbar(show: boolean) {
		this._elements.root.classList.toggle('toolbar', show);
		this._elements.toolbar1.classList.toggle('hidden', !show);
		this._elements.toolbar2.classList.toggle('hidden', !show);
		this._elements.status.classList.toggle('actions', show);
		this._elements.infoLabel.classList.toggle('hidden', show);
		this._onDidChangeHeight.fire();
	}

	async getCodeBlockInfo(codeBlockIndex: number): Promise<IResolvedTextEditorModel | undefined> {
		const { viewModel } = this._chatWidget;
		if (!viewModel) {
			return undefined;
		}
		const items = viewModel.getItems().filter(i => isResponseVM(i));
		if (!items.length) {
			return;
		}
		const item = items[items.length - 1];
		return viewModel.codeBlockModelCollection.get(viewModel.sessionId, item, codeBlockIndex)?.model;
	}

	get responseContent(): string | undefined {
		const requests = this._chatWidget.viewModel?.model.getRequests();
		if (!isNonEmptyArray(requests)) {
			return undefined;
		}
		return tail(requests)?.response?.response.toString();
	}


	getChatModel(): IChatModel {
		return this._chatWidget.viewModel?.model ?? this._defaultChatModel;
	}

	setChatModel(chatModel: IChatModel) {
		this._chatWidget.setModel(chatModel, { inputValue: undefined });
	}


	/**
	 * @deprecated use `setChatModel` instead
	 */
	addToHistory(input: string) {
		if (this._chatWidget.viewModel?.model === this._defaultChatModel) {
			this._chatWidget.input.acceptInput(true);
		}
	}

	/**
	 * @deprecated use `setChatModel` instead
	 */
	updateChatMessage(message: IInlineChatMessage, isIncomplete: true): IInlineChatMessageAppender;
	updateChatMessage(message: IInlineChatMessage | undefined): void;
	updateChatMessage(message: IInlineChatMessage | undefined, isIncomplete?: boolean, isCodeBlockEditable?: boolean): IInlineChatMessageAppender | undefined;
	updateChatMessage(message: IInlineChatMessage | undefined, isIncomplete?: boolean, isCodeBlockEditable?: boolean): IInlineChatMessageAppender | undefined {

		if (!this._chatWidget.viewModel || this._chatWidget.viewModel.model !== this._defaultChatModel) {
			// this can only be used with the default chat model
			return;
		}

		const model = this._defaultChatModel;
		if (!message?.message.value) {
			for (const request of model.getRequests()) {
				model.removeRequest(request.id);
			}
			return;
		}

		const chatRequest = model.addRequest({ parts: [], text: '' }, { variables: [] }, 0);
		model.acceptResponseProgress(chatRequest, {
			kind: 'markdownContent',
			content: message.message
		});

		if (!isIncomplete) {
			model.completeResponse(chatRequest);
			return;
		}
		return {
			cancel: () => model.cancelRequest(chatRequest),
			complete: () => model.completeResponse(chatRequest),
			appendContent: (fragment: string) => {
				model.acceptResponseProgress(chatRequest, {
					kind: 'markdownContent',
					content: new MarkdownString(fragment)
				});
			}
		};
	}

	updateInfo(message: string): void {
		this._elements.infoLabel.classList.toggle('hidden', !message);
		const renderedMessage = renderLabelWithIcons(message);
		reset(this._elements.infoLabel, ...renderedMessage);
		this._onDidChangeHeight.fire();
	}

	updateStatus(message: string, ops: { classes?: string[]; resetAfter?: number; keepMessage?: boolean; title?: string } = {}) {
		const isTempMessage = typeof ops.resetAfter === 'number';
		if (isTempMessage && !this._elements.statusLabel.dataset['state']) {
			const statusLabel = this._elements.statusLabel.innerText;
			const title = this._elements.statusLabel.dataset['title'];
			const classes = Array.from(this._elements.statusLabel.classList.values());
			setTimeout(() => {
				this.updateStatus(statusLabel, { classes, keepMessage: true, title });
			}, ops.resetAfter);
		}
		const renderedMessage = renderLabelWithIcons(message);
		reset(this._elements.statusLabel, ...renderedMessage);
		this._elements.statusLabel.className = `label status ${(ops.classes ?? []).join(' ')}`;
		this._elements.statusLabel.classList.toggle('hidden', !message);
		if (isTempMessage) {
			this._elements.statusLabel.dataset['state'] = 'temp';
		} else {
			delete this._elements.statusLabel.dataset['state'];
		}

		if (ops.title) {
			this._elements.statusLabel.dataset['title'] = ops.title;
		} else {
			delete this._elements.statusLabel.dataset['title'];
		}
		this._onDidChangeHeight.fire();
	}

	reset() {
		this._chatWidget.setContext(true);
		this._chatWidget.saveState();
		this.updateChatMessage(undefined);

		reset(this._elements.statusLabel);
		this._elements.statusLabel.classList.toggle('hidden', true);
		this._elements.toolbar1.classList.add('hidden');
		this._elements.toolbar2.classList.add('hidden');
		this.updateInfo('');

		this.chatWidget.setModel(this._defaultChatModel, {});

		this._elements.accessibleViewer.classList.toggle('hidden', true);
		this._onDidChangeHeight.fire();
	}

	focus() {
		this._chatWidget.focusInput();
	}

	hasFocus() {
		return this.domNode.contains(getActiveElement());
	}

}

const defaultAriaLabel = localize('aria-label', "Inline Chat Input");

export class EditorBasedInlineChatWidget extends InlineChatWidget {

	private readonly _accessibleViewer = this._store.add(new MutableDisposable<HunkAccessibleDiffViewer>());

	constructor(
		location: IChatWidgetLocationOptions,
		private readonly _parentEditor: ICodeEditor,
		options: IInlineChatWidgetConstructionOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibleViewService accessibleViewService: IAccessibleViewService,
		@ITextModelService textModelResolverService: ITextModelService,
		@IChatService chatService: IChatService,
		@IHoverService hoverService: IHoverService,
	) {
		super(location, { ...options, chatWidgetViewOptions: { ...options.chatWidgetViewOptions, editorOverflowWidgetsDomNode: _parentEditor.getOverflowWidgetsDomNode() } }, instantiationService, contextKeyService, keybindingService, accessibilityService, configurationService, accessibleViewService, textModelResolverService, chatService, hoverService);
	}

	// --- layout

	override get contentHeight(): number {
		let result = super.contentHeight;

		if (this._accessibleViewer.value) {
			result += this._accessibleViewer.value.height + 8 /* padding */;
		}

		return result;
	}

	protected override _doLayout(dimension: Dimension): void {

		let newHeight = dimension.height;

		if (this._accessibleViewer.value) {
			this._accessibleViewer.value.width = dimension.width - 12;
			newHeight -= this._accessibleViewer.value.height + 8;
		}

		super._doLayout(dimension.with(undefined, newHeight));

		// update/fix the height of the zone which was set to newHeight in super._doLayout
		this._elements.root.style.height = `${dimension.height - this._getExtraHeight()}px`;
	}

	override reset() {
		this._accessibleViewer.clear();
		super.reset();
	}

	// --- accessible viewer

	showAccessibleHunk(session: Session, hunkData: HunkInformation): void {

		this._elements.accessibleViewer.classList.remove('hidden');
		this._accessibleViewer.clear();

		this._accessibleViewer.value = this._instantiationService.createInstance(HunkAccessibleDiffViewer,
			this._elements.accessibleViewer,
			session,
			hunkData,
			new AccessibleHunk(this._parentEditor, session, hunkData)
		);

		this._onDidChangeHeight.fire();
	}
}

class HunkAccessibleDiffViewer extends AccessibleDiffViewer {

	readonly height: number;

	set width(value: number) {
		this._width2.set(value, undefined);
	}

	private readonly _width2: ISettableObservable<number>;

	constructor(
		parentNode: HTMLElement,
		session: Session,
		hunk: HunkInformation,
		models: IAccessibleDiffViewerModel,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		const width = observableValue('width', 0);
		const diff = observableValue('diff', HunkAccessibleDiffViewer._asMapping(hunk));
		const diffs = derived(r => [diff.read(r)]);
		const lines = Math.min(10, 8 + diff.get().changedLineCount);
		const height = models.getModifiedOptions().get(EditorOption.lineHeight) * lines;

		super(parentNode, constObservable(true), () => { }, constObservable(false), width, constObservable(height), diffs, models, instantiationService);

		this.height = height;
		this._width2 = width;

		this._store.add(session.textModelN.onDidChangeContent(() => {
			diff.set(HunkAccessibleDiffViewer._asMapping(hunk), undefined);
		}));
	}

	private static _asMapping(hunk: HunkInformation): DetailedLineRangeMapping {
		const ranges0 = hunk.getRanges0();
		const rangesN = hunk.getRangesN();
		const originalLineRange = LineRange.fromRangeInclusive(ranges0[0]);
		const modifiedLineRange = LineRange.fromRangeInclusive(rangesN[0]);
		const innerChanges: RangeMapping[] = [];
		for (let i = 1; i < ranges0.length; i++) {
			innerChanges.push(new RangeMapping(ranges0[i], rangesN[i]));
		}
		return new DetailedLineRangeMapping(originalLineRange, modifiedLineRange, innerChanges);
	}

}

class AccessibleHunk implements IAccessibleDiffViewerModel {

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _session: Session,
		private readonly _hunk: HunkInformation
	) { }

	getOriginalModel(): ITextModel {
		return this._session.textModel0;
	}
	getModifiedModel(): ITextModel {
		return this._session.textModelN;
	}
	getOriginalOptions(): IComputedEditorOptions {
		return this._editor.getOptions();
	}
	getModifiedOptions(): IComputedEditorOptions {
		return this._editor.getOptions();
	}
	originalReveal(range: Range): void {
		// throw new Error('Method not implemented.');
	}
	modifiedReveal(range?: Range | undefined): void {
		this._editor.revealRangeInCenterIfOutsideViewport(range || this._hunk.getRangesN()[0], ScrollType.Smooth);
	}
	modifiedSetSelection(range: Range): void {
		// this._editor.revealRangeInCenterIfOutsideViewport(range, ScrollType.Smooth);
		// this._editor.setSelection(range);
	}
	modifiedFocus(): void {
		this._editor.focus();
	}
	getModifiedPosition(): Position | undefined {
		return this._hunk.getRangesN()[0].getStartPosition();
	}
}
