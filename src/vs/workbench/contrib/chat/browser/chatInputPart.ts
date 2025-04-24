/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { DEFAULT_FONT_FAMILY } from '../../../../base/browser/fonts.js';
import { IHistoryNavigationWidget } from '../../../../base/browser/history.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { ActionViewItem, IActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import * as aria from '../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { IActionProvider } from '../../../../base/browser/ui/dropdown/dropdown.js';
import { createInstantHoverDelegate, getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { renderLabelWithIcons } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IAction, Separator, toAction, WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '../../../../base/common/actions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { HistoryNavigator2 } from '../../../../base/common/history.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorConstructionOptions } from '../../../../editor/browser/config/editorConfiguration.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { IDimension } from '../../../../editor/common/core/dimension.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { CopyPasteController } from '../../../../editor/contrib/dropOrPasteInto/browser/copyPasteController.js';
import { DropIntoEditorController } from '../../../../editor/contrib/dropOrPasteInto/browser/dropIntoEditorController.js';
import { ContentHoverController } from '../../../../editor/contrib/hover/browser/contentHoverController.js';
import { GlyphHoverController } from '../../../../editor/contrib/hover/browser/glyphHoverController.js';
import { LinkDetector } from '../../../../editor/contrib/links/browser/links.js';
import { SuggestController } from '../../../../editor/contrib/suggest/browser/suggestController.js';
import { localize } from '../../../../nls.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { MenuWorkbenchButtonBar } from '../../../../platform/actions/browser/buttonbar.js';
import { DropdownMenuActionViewItemWithKeybinding } from '../../../../platform/actions/browser/dropdownActionViewItemWithKeybinding.js';
import { DropdownWithPrimaryActionViewItem, IDropdownWithPrimaryActionViewItemOptions } from '../../../../platform/actions/browser/dropdownWithPrimaryActionViewItem.js';
import { getFlatActionBarActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IMenuService, MenuId, MenuItemAction } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerAndCreateHistoryNavigationContext } from '../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { WorkbenchList } from '../../../../platform/list/browser/listService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ISharedWebContentExtractorService } from '../../../../platform/webContentExtractor/common/webContentExtractor.js';
import { ResourceLabels } from '../../../browser/labels.js';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { AccessibilityCommandId } from '../../accessibility/common/accessibilityCommands.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions, setupSimpleEditorSelectionStyling } from '../../codeEditor/browser/simpleEditorOptions.js';
import { IChatAgentService } from '../common/chatAgents.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
import { IChatEditingSession } from '../common/chatEditingService.js';
import { ChatEntitlement, IChatEntitlementService } from '../common/chatEntitlementService.js';
import { IChatRequestVariableEntry, isImageVariableEntry, isPasteVariableEntry } from '../common/chatModel.js';
import { IChatFollowup, IChatService } from '../common/chatService.js';
import { IChatVariablesService } from '../common/chatVariables.js';
import { IChatResponseViewModel } from '../common/chatViewModel.js';
import { ChatInputHistoryMaxEntries, IChatHistoryEntry, IChatInputState, IChatWidgetHistoryService } from '../common/chatWidgetHistoryService.js';
import { ChatAgentLocation, ChatConfiguration, ChatMode, validateChatMode } from '../common/constants.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../common/languageModels.js';
import { CancelAction, ChatEditingSessionSubmitAction, ChatSubmitAction, ChatSwitchToNextModelActionId, IChatExecuteActionContext, IToggleChatModeArgs, ToggleAgentModeActionId } from './actions/chatExecuteActions.js';
import { AttachToolsAction } from './actions/chatToolActions.js';
import { ImplicitContextAttachmentWidget } from './attachments/implicitContextAttachment.js';
import { PromptAttachmentsCollectionWidget } from './attachments/promptAttachments/promptAttachmentsCollectionWidget.js';
import { IChatWidget } from './chat.js';
import { ChatAttachmentModel } from './chatAttachmentModel.js';
import { toChatVariable } from './chatAttachmentModel/chatPromptAttachmentsCollection.js';
import { DefaultChatAttachmentWidget, FileAttachmentWidget, ImageAttachmentWidget, PasteAttachmentWidget } from './chatAttachmentWidgets.js';
import { IDisposableReference } from './chatContentParts/chatCollections.js';
import { CollapsibleListPool, IChatCollapsibleListItem } from './chatContentParts/chatReferencesContentPart.js';
import { ChatDragAndDrop } from './chatDragAndDrop.js';
import { ChatEditingRemoveAllFilesAction, ChatEditingShowChangesAction } from './chatEditing/chatEditingActions.js';
import { ChatFollowups } from './chatFollowups.js';
import { ChatSelectedTools } from './chatSelectedTools.js';
import { IChatViewState } from './chatWidget.js';
import { ChatFileReference } from './contrib/chatDynamicVariables/chatFileReference.js';
import { ChatImplicitContext } from './contrib/chatImplicitContext.js';
import { ChatRelatedFiles } from './contrib/chatInputRelatedFilesContrib.js';
import { resizeImage } from './imageUtils.js';

const $ = dom.$;

const INPUT_EDITOR_MAX_HEIGHT = 250;

export interface IChatInputStyles {
	overlayBackground: string;
	listForeground: string;
	listBackground: string;
}

interface IChatInputPartOptions {
	renderFollowups: boolean;
	renderStyle?: 'compact';
	menus: {
		executeToolbar: MenuId;
		inputSideToolbar?: MenuId;
		telemetrySource?: string;
	};
	editorOverflowWidgetsDomNode?: HTMLElement;
	renderWorkingSet?: boolean;
	enableImplicitContext?: boolean;
	supportsChangingModes?: boolean;
}

export interface IWorkingSetEntry {
	uri: URI;
}

export class ChatInputPart extends Disposable implements IHistoryNavigationWidget {
	static readonly INPUT_SCHEME = 'chatSessionInput';
	private static _counter = 0;

	private _onDidLoadInputState = this._register(new Emitter<any>());
	readonly onDidLoadInputState = this._onDidLoadInputState.event;

	private _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur = this._onDidBlur.event;

	private _onDidChangeContext = this._register(new Emitter<{ removed?: IChatRequestVariableEntry[]; added?: IChatRequestVariableEntry[] }>());
	readonly onDidChangeContext = this._onDidChangeContext.event;

	private _onDidAcceptFollowup = this._register(new Emitter<{ followup: IChatFollowup; response: IChatResponseViewModel | undefined }>());
	readonly onDidAcceptFollowup = this._onDidAcceptFollowup.event;

	private readonly _attachmentModel: ChatAttachmentModel;
	public get attachmentModel(): ChatAttachmentModel {
		return this._attachmentModel;
	}

	readonly selectedToolsModel: ChatSelectedTools;

	public getAttachedAndImplicitContext(sessionId: string): IChatRequestVariableEntry[] {
		const contextArr = [...this.attachmentModel.attachments];
		if (this.implicitContext?.enabled && this.implicitContext.value) {
			contextArr.push(this.implicitContext.toBaseEntry());
		}

		// factor in nested file links of a prompt into the implicit context
		const variables = this.variableService.getDynamicVariables(sessionId);
		for (const variable of variables) {
			if (!(variable instanceof ChatFileReference)) {
				continue;
			}

			// the usual URIs list of prompt instructions is `bottom-up`, therefore
			// we do the same here - first add all child references to the list
			contextArr.push(
				...variable.allValidReferences.map((link) => {
					return toChatVariable(link, false);
				}),
			);
		}

		contextArr
			.push(...this.instructionAttachmentsPart.chatAttachments);

		return contextArr;
	}

	/**
	 * Check if the chat input part has any prompt instruction attachments.
	 */
	public get hasInstructionAttachments(): boolean {
		return !this.instructionAttachmentsPart.empty;
	}

	private _indexOfLastAttachedContextDeletedWithKeyboard: number = -1;

	private _implicitContext: ChatImplicitContext | undefined;
	public get implicitContext(): ChatImplicitContext | undefined {
		return this._implicitContext;
	}

	private _relatedFiles: ChatRelatedFiles | undefined;
	public get relatedFiles(): ChatRelatedFiles | undefined {
		return this._relatedFiles;
	}

	private _hasFileAttachmentContextKey: IContextKey<boolean>;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	private readonly _contextResourceLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this._onDidChangeVisibility.event });

	private readonly inputEditorMaxHeight: number;
	private inputEditorHeight = 0;
	private container!: HTMLElement;

	private inputSideToolbarContainer?: HTMLElement;

	private followupsContainer!: HTMLElement;
	private readonly followupsDisposables = this._register(new DisposableStore());

	private attachmentsContainer!: HTMLElement;

	private attachedContextContainer!: HTMLElement;
	private readonly attachedContextDisposables = this._register(new MutableDisposable<DisposableStore>());

	private relatedFilesContainer!: HTMLElement;

	private chatEditingSessionWidgetContainer!: HTMLElement;

	private _inputPartHeight: number = 0;
	get inputPartHeight() {
		return this._inputPartHeight;
	}

	private _followupsHeight: number = 0;
	get followupsHeight() {
		return this._followupsHeight;
	}

	private _editSessionWidgetHeight: number = 0;
	get editSessionWidgetHeight() {
		return this._editSessionWidgetHeight;
	}

	private _inputEditor!: CodeEditorWidget;
	private _inputEditorElement!: HTMLElement;

	private executeToolbar!: MenuWorkbenchToolBar;
	private inputActionsToolbar!: MenuWorkbenchToolBar;

	private addFilesToolbar: MenuWorkbenchToolBar | undefined;

	get inputEditor() {
		return this._inputEditor;
	}

	private readonly dnd: ChatDragAndDrop;

	private history: HistoryNavigator2<IChatHistoryEntry>;
	private historyNavigationBackwardsEnablement!: IContextKey<boolean>;
	private historyNavigationForewardsEnablement!: IContextKey<boolean>;
	private inputModel: ITextModel | undefined;
	private inputEditorHasText: IContextKey<boolean>;
	private chatCursorAtTop: IContextKey<boolean>;
	private inputEditorHasFocus: IContextKey<boolean>;
	/**
	 * Context key is set when prompt instructions are attached.
	 */
	private promptInstructionsAttached: IContextKey<boolean>;
	private chatMode: IContextKey<ChatMode>;

	private readonly _waitForPersistedLanguageModel = this._register(new MutableDisposable<IDisposable>());
	private _onDidChangeCurrentLanguageModel = this._register(new Emitter<ILanguageModelChatMetadataAndIdentifier>());
	private _currentLanguageModel: ILanguageModelChatMetadataAndIdentifier | undefined;
	get currentLanguageModel() {
		return this._currentLanguageModel?.identifier;
	}

	private _onDidChangeCurrentChatMode = this._register(new Emitter<void>());
	readonly onDidChangeCurrentChatMode = this._onDidChangeCurrentChatMode.event;

	private _currentMode: ChatMode = ChatMode.Ask;
	public get currentMode(): ChatMode {
		if (this.location === ChatAgentLocation.Panel && !this.chatService.unifiedViewEnabled) {
			return ChatMode.Ask;
		}

		return this._currentMode === ChatMode.Agent && !this.agentService.hasToolsAgent ?
			ChatMode.Edit :
			this._currentMode;
	}

	private cachedDimensions: dom.Dimension | undefined;
	private cachedExecuteToolbarWidth: number | undefined;
	private cachedInputToolbarWidth: number | undefined;

	readonly inputUri = URI.parse(`${ChatInputPart.INPUT_SCHEME}:input-${ChatInputPart._counter++}`);

	private readonly _chatEditsActionsDisposables = this._register(new DisposableStore());
	private readonly _chatEditsDisposables = this._register(new DisposableStore());
	private _chatEditsListPool: CollapsibleListPool;
	private _chatEditList: IDisposableReference<WorkbenchList<IChatCollapsibleListItem>> | undefined;
	get selectedElements(): URI[] {
		const edits = [];
		const editsList = this._chatEditList?.object;
		const selectedElements = editsList?.getSelectedElements() ?? [];
		for (const element of selectedElements) {
			if (element.kind === 'reference' && URI.isUri(element.reference)) {
				edits.push(element.reference);
			}
		}
		return edits;
	}

	private _attemptedWorkingSetEntriesCount: number = 0;
	/**
	 * The number of working set entries that the user actually wanted to attach.
	 * This is less than or equal to {@link ChatInputPart.chatEditWorkingSetFiles}.
	 */
	public get attemptedWorkingSetEntriesCount() {
		return this._attemptedWorkingSetEntriesCount;
	}

	private readonly getInputState: () => IChatInputState;

	/**
	 * Child widget of prompt instruction attachments.
	 * See {@linkcode PromptAttachmentsCollectionWidget}.
	 */
	private instructionAttachmentsPart: PromptAttachmentsCollectionWidget;

	constructor(
		// private readonly editorOptions: ChatEditorOptions, // TODO this should be used
		private readonly location: ChatAgentLocation,
		private readonly options: IChatInputPartOptions,
		styles: IChatInputStyles,
		getContribsInputState: () => any,
		@IChatWidgetHistoryService private readonly historyService: IChatWidgetHistoryService,
		@IModelService private readonly modelService: IModelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@IThemeService private readonly themeService: IThemeService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IStorageService private readonly storageService: IStorageService,
		@ILabelService private readonly labelService: ILabelService,
		@IChatVariablesService private readonly variableService: IChatVariablesService,
		@IChatAgentService private readonly agentService: IChatAgentService,
		@IChatService private readonly chatService: IChatService,
		@ISharedWebContentExtractorService private readonly sharedWebExtracterService: ISharedWebContentExtractorService,
	) {
		super();

		this._attachmentModel = this._register(this.instantiationService.createInstance(ChatAttachmentModel));
		this.selectedToolsModel = this._register(this.instantiationService.createInstance(ChatSelectedTools));
		this.dnd = this._register(this.instantiationService.createInstance(ChatDragAndDrop, this._attachmentModel, styles));

		this.getInputState = (): IChatInputState => {
			return {
				...getContribsInputState(),
				chatContextAttachments: this._attachmentModel.attachments,
				chatMode: this._currentMode,
			};
		};
		this.inputEditorMaxHeight = this.options.renderStyle === 'compact' ? INPUT_EDITOR_MAX_HEIGHT / 3 : INPUT_EDITOR_MAX_HEIGHT;

		this.inputEditorHasText = ChatContextKeys.inputHasText.bindTo(contextKeyService);
		this.chatCursorAtTop = ChatContextKeys.inputCursorAtTop.bindTo(contextKeyService);
		this.inputEditorHasFocus = ChatContextKeys.inputHasFocus.bindTo(contextKeyService);
		this.promptInstructionsAttached = ChatContextKeys.instructionsAttached.bindTo(contextKeyService);
		this.chatMode = ChatContextKeys.chatMode.bindTo(contextKeyService);

		this.history = this.loadHistory();
		this._register(this.historyService.onDidClearHistory(() => this.history = new HistoryNavigator2([{ text: '' }], ChatInputHistoryMaxEntries, historyKeyFn)));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AccessibilityVerbositySettingId.Chat)) {
				this.inputEditor.updateOptions({ ariaLabel: this._getAriaLabel() });
			}
		}));

		this._chatEditsListPool = this._register(this.instantiationService.createInstance(CollapsibleListPool, this._onDidChangeVisibility.event, MenuId.ChatEditingWidgetModifiedFilesToolbar));

		this._hasFileAttachmentContextKey = ChatContextKeys.hasFileAttachments.bindTo(contextKeyService);

		this.instructionAttachmentsPart = this._register(
			instantiationService.createInstance(
				PromptAttachmentsCollectionWidget,
				this.attachmentModel.promptInstructions,
				this._contextResourceLabels,
			),
		);

		// trigger re-layout of chat input when number of instruction attachment changes
		this.instructionAttachmentsPart.onAttachmentsCountChange(() => {
			this._onDidChangeHeight.fire();
		});

		this.initSelectedModel();

		this._register(agentService.onDidChangeAgents(() => {
			if (!agentService.hasToolsAgent && this._currentMode === ChatMode.Agent) {
				this.setChatMode(ChatMode.Edit);
			}
		}));
	}

	private getSelectedModelStorageKey(): string {
		return `chat.currentLanguageModel.${this.location}`;
	}

	private initSelectedModel() {
		const persistedSelection = this.storageService.get(this.getSelectedModelStorageKey(), StorageScope.APPLICATION);
		if (persistedSelection) {
			const model = this.languageModelsService.lookupLanguageModel(persistedSelection);
			if (model) {
				this.setCurrentLanguageModel({ metadata: model, identifier: persistedSelection });
				this.checkModelSupported();
			} else {
				this._waitForPersistedLanguageModel.value = this.languageModelsService.onDidChangeLanguageModels(e => {
					const persistedModel = e.added?.find(m => m.identifier === persistedSelection);
					if (persistedModel) {
						this._waitForPersistedLanguageModel.clear();

						if (persistedModel.metadata.isUserSelectable) {
							this.setCurrentLanguageModel({ metadata: persistedModel.metadata, identifier: persistedSelection });
							this.checkModelSupported();
						}
					}
				});
			}
		}

		this._register(this._onDidChangeCurrentChatMode.event(() => {
			this.checkModelSupported();
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.Edits2Enabled)) {
				this.checkModelSupported();
			}
		}));
	}

	public switchToNextModel(): void {
		const models = this.getModels();
		if (models.length > 0) {
			const currentIndex = models.findIndex(model => model.identifier === this._currentLanguageModel?.identifier);
			const nextIndex = (currentIndex + 1) % models.length;
			this.setCurrentLanguageModel(models[nextIndex]);
		}
	}

	private checkModelSupported(): void {
		if (this._currentLanguageModel && !this.modelSupportedForDefaultAgent(this._currentLanguageModel)) {
			this.setCurrentLanguageModelToDefault();
		}
	}

	setChatMode(mode: ChatMode): void {
		if (!this.options.supportsChangingModes) {
			return;
		}

		mode = validateChatMode(mode) ?? (this.location === ChatAgentLocation.Panel ? ChatMode.Ask : ChatMode.Edit);
		if (mode === ChatMode.Agent && !this.agentService.hasToolsAgent) {
			mode = ChatMode.Edit;
		}

		this._currentMode = mode;
		this.chatMode.set(mode);
		this._onDidChangeCurrentChatMode.fire();
	}

	private modelSupportedForDefaultAgent(model: ILanguageModelChatMetadataAndIdentifier): boolean {
		// Probably this logic could live in configuration on the agent, or somewhere else, if it gets more complex
		if (this.currentMode === ChatMode.Agent || (this.currentMode === ChatMode.Edit && this.configurationService.getValue(ChatConfiguration.Edits2Enabled))) {
			if (this.configurationService.getValue('chat.agent.allModels')) {
				return true;
			}

			const supportsToolsAgent = typeof model.metadata.capabilities?.agentMode === 'undefined' || model.metadata.capabilities.agentMode;

			// Filter out models that don't support tool calling, and models that don't support enough context to have a good experience with the tools agent
			return supportsToolsAgent && !!model.metadata.capabilities?.toolCalling;
		}

		return true;
	}

	private getModels(): ILanguageModelChatMetadataAndIdentifier[] {
		const models = this.languageModelsService.getLanguageModelIds()
			.map(modelId => ({ identifier: modelId, metadata: this.languageModelsService.lookupLanguageModel(modelId)! }))
			.filter(entry => entry.metadata?.isUserSelectable && this.modelSupportedForDefaultAgent(entry));
		models.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

		return models;
	}

	private setCurrentLanguageModelToDefault() {
		const defaultLanguageModelId = this.languageModelsService.getLanguageModelIds().find(id => this.languageModelsService.lookupLanguageModel(id)?.isDefault);
		const hasUserSelectableLanguageModels = this.languageModelsService.getLanguageModelIds().find(id => {
			const model = this.languageModelsService.lookupLanguageModel(id);
			return model?.isUserSelectable && !model.isDefault;
		});
		const defaultModel = hasUserSelectableLanguageModels && defaultLanguageModelId ?
			{ metadata: this.languageModelsService.lookupLanguageModel(defaultLanguageModelId)!, identifier: defaultLanguageModelId } :
			undefined;
		if (defaultModel) {
			this.setCurrentLanguageModel(defaultModel);
		}
	}

	private setCurrentLanguageModel(model: ILanguageModelChatMetadataAndIdentifier) {
		this._currentLanguageModel = model;

		if (this.cachedDimensions) {
			// For quick chat and editor chat, relayout because the input may need to shrink to accomodate the model name
			this.layout(this.cachedDimensions.height, this.cachedDimensions.width);
		}

		this.storageService.store(this.getSelectedModelStorageKey(), model.identifier, StorageScope.APPLICATION, StorageTarget.USER);

		this._onDidChangeCurrentLanguageModel.fire(model);
	}

	private loadHistory(): HistoryNavigator2<IChatHistoryEntry> {
		const history = this.historyService.getHistory(this.location);
		if (history.length === 0) {
			history.push({ text: '' });
		}

		return new HistoryNavigator2(history, 50, historyKeyFn);
	}

	private _getAriaLabel(): string {
		const verbose = this.configurationService.getValue<boolean>(AccessibilityVerbositySettingId.Chat);
		if (verbose) {
			const kbLabel = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp)?.getLabel();
			return kbLabel ? localize('actions.chat.accessibiltyHelp', "Chat Input,  Type to ask questions or type / for topics, press enter to send out the request. Use {0} for Chat Accessibility Help.", kbLabel) : localize('chatInput.accessibilityHelpNoKb', "Chat Input,  Type code here and press Enter to run. Use the Chat Accessibility Help command for more information.");
		}
		return localize('chatInput', "Chat Input");
	}

	initForNewChatModel(state: IChatViewState): void {
		this.history = this.loadHistory();
		this.history.add({
			text: state.inputValue ?? this.history.current().text,
			state: state.inputState ?? this.getInputState()
		});
		const attachments = state.inputState?.chatContextAttachments ?? [];
		this._attachmentModel.clearAndSetContext(...attachments);

		if (state.inputValue) {
			this.setValue(state.inputValue, false);
		}

		if (state.inputState?.chatMode) {
			this.setChatMode(state.inputState.chatMode);
		} else if (this.location === ChatAgentLocation.EditingSession) {
			this.setChatMode(ChatMode.Edit);
		}
	}

	logInputHistory(): void {
		const historyStr = [...this.history].map(entry => JSON.stringify(entry)).join('\n');
		this.logService.info(`[${this.location}] Chat input history:`, historyStr);
	}

	setVisible(visible: boolean): void {
		this._onDidChangeVisibility.fire(visible);
	}

	get element(): HTMLElement {
		return this.container;
	}

	async showPreviousValue(): Promise<void> {
		const inputState = this.getInputState();
		if (this.history.isAtEnd()) {
			this.saveCurrentValue(inputState);
		} else {
			const currentEntry = this.getFilteredEntry(this._inputEditor.getValue(), inputState);
			if (!this.history.has(currentEntry)) {
				this.saveCurrentValue(inputState);
				this.history.resetCursor();
			}
		}

		this.navigateHistory(true);
	}

	async showNextValue(): Promise<void> {
		const inputState = this.getInputState();
		if (this.history.isAtEnd()) {
			return;
		} else {
			const currentEntry = this.getFilteredEntry(this._inputEditor.getValue(), inputState);
			if (!this.history.has(currentEntry)) {
				this.saveCurrentValue(inputState);
				this.history.resetCursor();
			}
		}

		this.navigateHistory(false);
	}

	private async navigateHistory(previous: boolean): Promise<void> {
		const historyEntry = previous ?
			this.history.previous() : this.history.next();

		let historyAttachments = historyEntry.state?.chatContextAttachments ?? [];

		// Check for images in history to restore the value.
		if (historyAttachments.length > 0) {
			historyAttachments = (await Promise.all(historyAttachments.map(async (attachment) => {
				if (attachment.isImage && attachment.references?.length && URI.isUri(attachment.references[0].reference)) {
					const currReference = attachment.references[0].reference;
					try {
						const imageBinary = currReference.toString(true).startsWith('http') ? await this.sharedWebExtracterService.readImage(currReference, CancellationToken.None) : (await this.fileService.readFile(currReference)).value;
						if (!imageBinary) {
							return undefined;
						}
						const newAttachment = { ...attachment };
						newAttachment.value = (isImageVariableEntry(attachment) && attachment.isPasted) ? imageBinary.buffer : await resizeImage(imageBinary.buffer); // if pasted image, we do not need to resize.
						return newAttachment;
					} catch (err) {
						this.logService.error('Failed to fetch and reference.', err);
						return undefined;
					}
				}
				return attachment;
			}))).filter(attachment => attachment !== undefined);
		}

		this._attachmentModel.clearAndSetContext(...historyAttachments);

		aria.status(historyEntry.text);
		this.setValue(historyEntry.text, true);

		this._onDidLoadInputState.fire(historyEntry.state);

		const model = this._inputEditor.getModel();
		if (!model) {
			return;
		}

		if (previous) {
			const endOfFirstViewLine = this._inputEditor._getViewModel()?.getLineLength(1) ?? 1;
			const endOfFirstModelLine = model.getLineLength(1);
			if (endOfFirstViewLine === endOfFirstModelLine) {
				// Not wrapped - set cursor to the end of the first line
				this._inputEditor.setPosition({ lineNumber: 1, column: endOfFirstViewLine + 1 });
			} else {
				// Wrapped - set cursor one char short of the end of the first view line.
				// If it's after the next character, the cursor shows on the second line.
				this._inputEditor.setPosition({ lineNumber: 1, column: endOfFirstViewLine });
			}
		} else {
			this._inputEditor.setPosition(getLastPosition(model));
		}
	}

	setValue(value: string, transient: boolean): void {
		this.inputEditor.setValue(value);
		// always leave cursor at the end
		this.inputEditor.setPosition({ lineNumber: 1, column: value.length + 1 });

		if (!transient) {
			this.saveCurrentValue(this.getInputState());
		}
	}

	private saveCurrentValue(inputState: IChatInputState): void {
		const newEntry = this.getFilteredEntry(this._inputEditor.getValue(), inputState);
		this.history.replaceLast(newEntry);
	}

	focus() {
		this._inputEditor.focus();
	}

	hasFocus(): boolean {
		return this._inputEditor.hasWidgetFocus();
	}

	/**
	 * Reset the input and update history.
	 * @param userQuery If provided, this will be added to the history. Followups and programmatic queries should not be passed.
	 */
	async acceptInput(isUserQuery?: boolean): Promise<void> {
		if (isUserQuery) {
			const userQuery = this._inputEditor.getValue();
			const inputState = this.getInputState();
			const entry = this.getFilteredEntry(userQuery, inputState);
			this.history.replaceLast(entry);
			this.history.add({ text: '' });
		}

		// Clear attached context, fire event to clear input state, and clear the input editor
		this.attachmentModel.clear();
		this._onDidLoadInputState.fire({});
		if (this.accessibilityService.isScreenReaderOptimized() && isMacintosh) {
			this._acceptInputForVoiceover();
		} else {
			this._inputEditor.focus();
			this._inputEditor.setValue('');
		}
	}

	// A funtion that filters out specifically the `value` property of the attachment.
	private getFilteredEntry(query: string, inputState: IChatInputState): IChatHistoryEntry {
		const attachmentsWithoutImageValues = inputState.chatContextAttachments?.map(attachment => {
			if (attachment.isImage && attachment.references?.length && attachment.value) {
				const newAttachment = { ...attachment };
				newAttachment.value = undefined;
				return newAttachment;
			}
			return attachment;
		});

		inputState.chatContextAttachments = attachmentsWithoutImageValues;
		const newEntry = {
			text: query,
			state: inputState,
		};

		return newEntry;
	}

	private _acceptInputForVoiceover(): void {
		const domNode = this._inputEditor.getDomNode();
		if (!domNode) {
			return;
		}
		// Remove the input editor from the DOM temporarily to prevent VoiceOver
		// from reading the cleared text (the request) to the user.
		domNode.remove();
		this._inputEditor.setValue('');
		this._inputEditorElement.appendChild(domNode);
		this._inputEditor.focus();
	}

	private _handleAttachedContextChange() {
		this._hasFileAttachmentContextKey.set(Boolean(this._attachmentModel.attachments.find(a => a.isFile)));
		this.renderAttachedContext();
	}

	render(container: HTMLElement, initialValue: string, widget: IChatWidget) {
		let elements;
		if (this.options.renderStyle === 'compact') {
			elements = dom.h('.interactive-input-part', [
				dom.h('.interactive-input-and-edit-session', [
					dom.h('.chat-editing-session@chatEditingSessionWidgetContainer'),
					dom.h('.interactive-input-and-side-toolbar@inputAndSideToolbar', [
						dom.h('.chat-input-container@inputContainer', [
							dom.h('.chat-editor-container@editorContainer'),
							dom.h('.chat-input-toolbars@inputToolbars'),
						]),
					]),
					dom.h('.chat-attachments-container@attachmentsContainer', [
						dom.h('.chat-attachment-toolbar@attachmentToolbar'),
						dom.h('.chat-attached-context@attachedContextContainer'),
						dom.h('.chat-related-files@relatedFilesContainer'),
					]),
					dom.h('.interactive-input-followups@followupsContainer'),
				])
			]);
		} else {
			elements = dom.h('.interactive-input-part', [
				dom.h('.interactive-input-followups@followupsContainer'),
				dom.h('.chat-editing-session@chatEditingSessionWidgetContainer'),
				dom.h('.interactive-input-and-side-toolbar@inputAndSideToolbar', [
					dom.h('.chat-input-container@inputContainer', [
						dom.h('.chat-attachments-container@attachmentsContainer', [
							dom.h('.chat-attachment-toolbar@attachmentToolbar'),
							dom.h('.chat-related-files@relatedFilesContainer'),
							dom.h('.chat-attached-context@attachedContextContainer'),
						]),
						dom.h('.chat-editor-container@editorContainer'),
						dom.h('.chat-input-toolbars@inputToolbars'),
					]),
				]),
			]);
		}
		this.container = elements.root;
		container.append(this.container);
		this.container.classList.toggle('compact', this.options.renderStyle === 'compact');
		this.followupsContainer = elements.followupsContainer;
		const inputAndSideToolbar = elements.inputAndSideToolbar; // The chat input and toolbar to the right
		const inputContainer = elements.inputContainer; // The chat editor, attachments, and toolbars
		const editorContainer = elements.editorContainer;
		this.attachmentsContainer = elements.attachmentsContainer;
		this.attachedContextContainer = elements.attachedContextContainer;
		this.relatedFilesContainer = elements.relatedFilesContainer;
		const toolbarsContainer = elements.inputToolbars;
		const attachmentToolbarContainer = elements.attachmentToolbar;
		this.chatEditingSessionWidgetContainer = elements.chatEditingSessionWidgetContainer;
		if (this.options.enableImplicitContext) {
			this._implicitContext = this._register(new ChatImplicitContext());
			this._register(this._implicitContext.onDidChangeValue(() => this._handleAttachedContextChange()));
		}

		this.renderAttachedContext();
		this._register(this._attachmentModel.onDidChangeContext(() => this._handleAttachedContextChange()));
		this.renderChatEditingSessionState(null);

		if (this.options.renderWorkingSet) {
			this._relatedFiles = this._register(new ChatRelatedFiles());
			this._register(this._relatedFiles.onDidChange(() => this.renderChatRelatedFiles()));
		}
		this.renderChatRelatedFiles();

		this.dnd.addOverlay(container, container);

		const inputScopedContextKeyService = this._register(this.contextKeyService.createScoped(inputContainer));
		ChatContextKeys.inChatInput.bindTo(inputScopedContextKeyService).set(true);
		const scopedInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, inputScopedContextKeyService])));

		const { historyNavigationBackwardsEnablement, historyNavigationForwardsEnablement } = this._register(registerAndCreateHistoryNavigationContext(inputScopedContextKeyService, this));
		this.historyNavigationBackwardsEnablement = historyNavigationBackwardsEnablement;
		this.historyNavigationForewardsEnablement = historyNavigationForwardsEnablement;

		const options: IEditorConstructionOptions = getSimpleEditorOptions(this.configurationService);
		options.overflowWidgetsDomNode = this.options.editorOverflowWidgetsDomNode;
		options.pasteAs = EditorOptions.pasteAs.defaultValue;
		options.readOnly = false;
		options.ariaLabel = this._getAriaLabel();
		options.fontFamily = DEFAULT_FONT_FAMILY;
		options.fontSize = 13;
		options.lineHeight = 20;
		options.padding = this.options.renderStyle === 'compact' ? { top: 2, bottom: 2 } : { top: 8, bottom: 8 };
		options.cursorWidth = 1;
		options.wrappingStrategy = 'advanced';
		options.bracketPairColorization = { enabled: false };
		options.suggest = {
			showIcons: true,
			showSnippets: false,
			showWords: true,
			showStatusBar: false,
			insertMode: 'replace',
		};
		options.scrollbar = { ...(options.scrollbar ?? {}), vertical: 'hidden' };
		options.stickyScroll = { enabled: false };

		this._inputEditorElement = dom.append(editorContainer!, $(chatInputEditorContainerSelector));
		const editorOptions = getSimpleCodeEditorWidgetOptions();
		editorOptions.contributions?.push(...EditorExtensionsRegistry.getSomeEditorContributions([ContentHoverController.ID, GlyphHoverController.ID, CopyPasteController.ID, LinkDetector.ID]));
		this._inputEditor = this._register(scopedInstantiationService.createInstance(CodeEditorWidget, this._inputEditorElement, options, editorOptions));

		SuggestController.get(this._inputEditor)?.forceRenderingAbove();
		options.overflowWidgetsDomNode?.classList.add('hideSuggestTextIcons');
		this._inputEditorElement.classList.add('hideSuggestTextIcons');

		this._register(this._inputEditor.onDidChangeModelContent(() => {
			const currentHeight = Math.min(this._inputEditor.getContentHeight(), this.inputEditorMaxHeight);
			if (currentHeight !== this.inputEditorHeight) {
				this.inputEditorHeight = currentHeight;
				this._onDidChangeHeight.fire();
			}

			const model = this._inputEditor.getModel();
			const inputHasText = !!model && model.getValue().trim().length > 0;
			this.inputEditorHasText.set(inputHasText);
		}));
		this._register(this._inputEditor.onDidContentSizeChange(e => {
			if (e.contentHeightChanged) {
				this.inputEditorHeight = e.contentHeight;
				this._onDidChangeHeight.fire();
			}
		}));
		this._register(this._inputEditor.onDidFocusEditorText(() => {
			this.inputEditorHasFocus.set(true);
			this._onDidFocus.fire();
			inputContainer.classList.toggle('focused', true);
		}));
		this._register(this._inputEditor.onDidBlurEditorText(() => {
			this.inputEditorHasFocus.set(false);
			inputContainer.classList.toggle('focused', false);

			this._onDidBlur.fire();
		}));
		this._register(this._inputEditor.onDidBlurEditorWidget(() => {
			CopyPasteController.get(this._inputEditor)?.clearWidgets();
			DropIntoEditorController.get(this._inputEditor)?.clearWidgets();
		}));

		const hoverDelegate = this._register(createInstantHoverDelegate());

		this._register(dom.addStandardDisposableListener(toolbarsContainer, dom.EventType.CLICK, e => this.inputEditor.focus()));
		this._register(dom.addStandardDisposableListener(this.attachmentsContainer, dom.EventType.CLICK, e => this.inputEditor.focus()));
		this.inputActionsToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, toolbarsContainer, MenuId.ChatInput, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: { shouldForwardArgs: true },
			hiddenItemStrategy: HiddenItemStrategy.Ignore,
			hoverDelegate
		}));
		this.inputActionsToolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.inputActionsToolbar.onDidChangeMenuItems(() => {
			if (this.cachedDimensions && typeof this.cachedInputToolbarWidth === 'number' && this.cachedInputToolbarWidth !== this.inputActionsToolbar.getItemsWidth()) {
				this.layout(this.cachedDimensions.height, this.cachedDimensions.width);
			}
		}));
		this.executeToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, toolbarsContainer, this.options.menus.executeToolbar, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: {
				shouldForwardArgs: true
			},
			hoverDelegate,
			hiddenItemStrategy: HiddenItemStrategy.Ignore, // keep it lean when hiding items and avoid a "..." overflow menu
			actionViewItemProvider: (action, options) => {
				if (this.location === ChatAgentLocation.Panel || this.location === ChatAgentLocation.Editor) {
					if ((action.id === ChatSubmitAction.ID || action.id === CancelAction.ID || action.id === ChatEditingSessionSubmitAction.ID) && action instanceof MenuItemAction) {
						const dropdownAction = this.instantiationService.createInstance(MenuItemAction, { id: 'chat.moreExecuteActions', title: localize('notebook.moreExecuteActionsLabel', "More..."), icon: Codicon.chevronDown }, undefined, undefined, undefined, undefined);
						return this.instantiationService.createInstance(ChatSubmitDropdownActionItem, action, dropdownAction, { ...options, menuAsChild: false });
					}
				}

				if (action.id === ChatSwitchToNextModelActionId && action instanceof MenuItemAction) {
					if (!this._currentLanguageModel) {
						this.setCurrentLanguageModelToDefault();
					}

					if (this._currentLanguageModel) {
						const itemDelegate: ModelPickerDelegate = {
							onDidChangeModel: this._onDidChangeCurrentLanguageModel.event,
							setModel: (model: ILanguageModelChatMetadataAndIdentifier) => {
								// The user changed the language model, so we don't wait for the persisted option to be registered
								this._waitForPersistedLanguageModel.clear();
								this.setCurrentLanguageModel(model);
								this.renderAttachedContext();
							},
							getModels: () => this.getModels()
						};
						return this.instantiationService.createInstance(ModelPickerActionViewItem, action, this._currentLanguageModel, itemDelegate);
					}
				} else if (action.id === ToggleAgentModeActionId && action instanceof MenuItemAction) {
					const delegate: IModePickerDelegate = {
						getMode: () => this.currentMode,
						onDidChangeMode: this._onDidChangeCurrentChatMode.event
					};
					return this.instantiationService.createInstance(ToggleChatModeActionViewItem, action, delegate);
				}

				return undefined;
			}
		}));
		this.executeToolbar.getElement().classList.add('chat-execute-toolbar');
		this.executeToolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.executeToolbar.onDidChangeMenuItems(() => {
			if (this.cachedDimensions && typeof this.cachedExecuteToolbarWidth === 'number' && this.cachedExecuteToolbarWidth !== this.executeToolbar.getItemsWidth()) {
				this.layout(this.cachedDimensions.height, this.cachedDimensions.width);
			}
		}));
		if (this.options.menus.inputSideToolbar) {
			const toolbarSide = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, inputAndSideToolbar, this.options.menus.inputSideToolbar, {
				telemetrySource: this.options.menus.telemetrySource,
				menuOptions: {
					shouldForwardArgs: true
				},
				hoverDelegate
			}));
			this.inputSideToolbarContainer = toolbarSide.getElement();
			toolbarSide.getElement().classList.add('chat-side-toolbar');
			toolbarSide.context = { widget } satisfies IChatExecuteActionContext;
		}

		let inputModel = this.modelService.getModel(this.inputUri);
		if (!inputModel) {
			inputModel = this.modelService.createModel('', null, this.inputUri, true);
		}

		this.textModelResolverService.createModelReference(this.inputUri).then(ref => {
			// make sure to hold a reference so that the model doesn't get disposed by the text model service
			if (this._store.isDisposed) {
				ref.dispose();
				return;
			}
			this._register(ref);
		});

		this.inputModel = inputModel;
		this.inputModel.updateOptions({ bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
		this._inputEditor.setModel(this.inputModel);
		if (initialValue) {
			this.inputModel.setValue(initialValue);
			const lineNumber = this.inputModel.getLineCount();
			this._inputEditor.setPosition({ lineNumber, column: this.inputModel.getLineMaxColumn(lineNumber) });
		}

		const onDidChangeCursorPosition = () => {
			const model = this._inputEditor.getModel();
			if (!model) {
				return;
			}

			const position = this._inputEditor.getPosition();
			if (!position) {
				return;
			}

			const atTop = position.lineNumber === 1 && position.column - 1 <= (this._inputEditor._getViewModel()?.getLineLength(1) ?? 0);
			this.chatCursorAtTop.set(atTop);

			this.historyNavigationBackwardsEnablement.set(atTop);
			this.historyNavigationForewardsEnablement.set(position.equals(getLastPosition(model)));
		};
		this._register(this._inputEditor.onDidChangeCursorPosition(e => onDidChangeCursorPosition()));
		onDidChangeCursorPosition();

		this._register(this.themeService.onDidFileIconThemeChange(() => {
			this.renderAttachedContext();
		}));

		this.addFilesToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, attachmentToolbarContainer, MenuId.ChatInputAttachmentToolbar, {
			telemetrySource: this.options.menus.telemetrySource,
			label: true,
			menuOptions: { shouldForwardArgs: true, renderShortTitle: true },
			hiddenItemStrategy: HiddenItemStrategy.Ignore,
			hoverDelegate,
			actionViewItemProvider: (action, options) => {
				if (action.id === 'workbench.action.chat.editing.attachContext' || action.id === 'workbench.action.chat.attachContext') {
					const viewItem = this.instantiationService.createInstance(AddFilesButton, undefined, action, options);
					return viewItem;
				}
				if (action.id === AttachToolsAction.id) {
					return this.selectedToolsModel.toolsActionItemViewItemProvider(action, options);
				}
				return undefined;
			}
		}));
		this.addFilesToolbar.context = { widget, placeholder: localize('chatAttachFiles', 'Search for files and context to add to your request') };
		this._register(this.addFilesToolbar.onDidChangeMenuItems(() => {
			if (this.cachedDimensions) {
				this._onDidChangeHeight.fire();
			}
		}));

		this._register(this.selectedToolsModel.toolsActionItemViewItemProvider.onDidRender(() => this._onDidChangeHeight.fire()));
	}

	private renderAttachedContext() {
		const container = this.attachedContextContainer;
		// Note- can't measure attachedContextContainer, because it has `display: contents`, so measure the parent to check for height changes
		const oldHeight = this.attachmentsContainer.offsetHeight;
		const store = new DisposableStore();
		this.attachedContextDisposables.value = store;

		dom.clearNode(container);
		const hoverDelegate = store.add(createInstantHoverDelegate());

		const attachments = [...this.attachmentModel.attachments.entries()];
		const hasAttachments = Boolean(attachments.length) || Boolean(this.implicitContext?.value) || !this.instructionAttachmentsPart.empty;
		dom.setVisibility(Boolean(hasAttachments || (this.addFilesToolbar && !this.addFilesToolbar.isEmpty())), this.attachmentsContainer);
		dom.setVisibility(hasAttachments, this.attachedContextContainer);
		if (!attachments.length) {
			this._indexOfLastAttachedContextDeletedWithKeyboard = -1;
		}

		if (this.implicitContext?.value) {
			const implicitPart = store.add(this.instantiationService.createInstance(ImplicitContextAttachmentWidget, this.implicitContext, this._contextResourceLabels));
			container.appendChild(implicitPart.domNode);
		}

		this.promptInstructionsAttached.set(!this.instructionAttachmentsPart.empty);
		this.instructionAttachmentsPart.render(container);

		for (const [index, attachment] of attachments) {
			const resource = URI.isUri(attachment.value) ? attachment.value : attachment.value && typeof attachment.value === 'object' && 'uri' in attachment.value && URI.isUri(attachment.value.uri) ? attachment.value.uri : undefined;
			const range = attachment.value && typeof attachment.value === 'object' && 'range' in attachment.value && Range.isIRange(attachment.value.range) ? attachment.value.range : undefined;
			const shouldFocusClearButton = index === Math.min(this._indexOfLastAttachedContextDeletedWithKeyboard, this.attachmentModel.size - 1);

			let attachmentWidget;
			if (resource && (attachment.isFile || attachment.isDirectory)) {
				attachmentWidget = this.instantiationService.createInstance(FileAttachmentWidget, resource, range, attachment, this._currentLanguageModel, shouldFocusClearButton, container, this._contextResourceLabels, hoverDelegate);
			} else if (attachment.isImage) {
				attachmentWidget = this.instantiationService.createInstance(ImageAttachmentWidget, resource, attachment, this._currentLanguageModel, shouldFocusClearButton, container, this._contextResourceLabels, hoverDelegate);
			} else if (isPasteVariableEntry(attachment)) {
				attachmentWidget = this.instantiationService.createInstance(PasteAttachmentWidget, attachment, this._currentLanguageModel, shouldFocusClearButton, container, this._contextResourceLabels, hoverDelegate);
			} else {
				attachmentWidget = this.instantiationService.createInstance(DefaultChatAttachmentWidget, resource, range, attachment, this._currentLanguageModel, shouldFocusClearButton, container, this._contextResourceLabels, hoverDelegate);
			}
			store.add(attachmentWidget);
			store.add(attachmentWidget.onDidDelete((e) => {
				this.handleAttachmentDeletion(e, index, attachment);
			}));
		}

		if (oldHeight !== this.attachmentsContainer.offsetHeight) {
			this._onDidChangeHeight.fire();
		}
	}

	private handleAttachmentDeletion(e: globalThis.Event, index: number, attachment: IChatRequestVariableEntry) {
		this._attachmentModel.delete(attachment.id);

		// Set focus to the next attached context item if deletion was triggered by a keystroke (vs a mouse click)
		if (dom.isKeyboardEvent(e)) {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				this._indexOfLastAttachedContextDeletedWithKeyboard = index;
			}
		}

		if (this._attachmentModel.size === 0) {
			this.focus();
		}

		this._onDidChangeContext.fire({ removed: [attachment] });
	}

	async renderChatEditingSessionState(chatEditingSession: IChatEditingSession | null) {
		dom.setVisibility(Boolean(chatEditingSession), this.chatEditingSessionWidgetContainer);

		const seenEntries = new ResourceSet();
		const entries: IChatCollapsibleListItem[] = chatEditingSession?.entries.get().map((entry) => {
			seenEntries.add(entry.modifiedURI);
			return {
				reference: entry.modifiedURI,
				state: entry.state.get(),
				kind: 'reference',
			};
		}) ?? [];

		if (!chatEditingSession || !this.options.renderWorkingSet || !entries.length) {
			dom.clearNode(this.chatEditingSessionWidgetContainer);
			this._chatEditsDisposables.clear();
			this._chatEditList = undefined;
			return;
		}

		// Summary of number of files changed
		const innerContainer = this.chatEditingSessionWidgetContainer.querySelector('.chat-editing-session-container.show-file-icons') as HTMLElement ?? dom.append(this.chatEditingSessionWidgetContainer, $('.chat-editing-session-container.show-file-icons'));
		for (const entry of chatEditingSession.entries.get()) {
			if (!seenEntries.has(entry.modifiedURI)) {
				entries.unshift({
					reference: entry.modifiedURI,
					state: entry.state.get(),
					kind: 'reference',
				});
				seenEntries.add(entry.modifiedURI);
			}
		}

		entries.sort((a, b) => {
			if (a.kind === 'reference' && b.kind === 'reference') {
				if (a.state === b.state || a.state === undefined || b.state === undefined) {
					return a.reference.toString().localeCompare(b.reference.toString());
				}
				return a.state - b.state;
			}
			return 0;
		});

		const overviewRegion = innerContainer.querySelector('.chat-editing-session-overview') as HTMLElement ?? dom.append(innerContainer, $('.chat-editing-session-overview'));
		const overviewTitle = overviewRegion.querySelector('.working-set-title') as HTMLElement ?? dom.append(overviewRegion, $('.working-set-title'));
		const overviewFileCount = overviewTitle.querySelector('span.working-set-count') ?? dom.append(overviewTitle, $('span.working-set-count'));

		overviewFileCount.textContent = entries.length === 1 ? localize('chatEditingSession.oneFile.1', '1 file changed') : localize('chatEditingSession.manyFiles.1', '{0} files changed', entries.length);

		overviewTitle.ariaLabel = overviewFileCount.textContent;
		overviewTitle.tabIndex = 0;

		// Clear out the previous actions (if any)
		this._chatEditsActionsDisposables.clear();

		// Chat editing session actions
		const actionsContainer = overviewRegion.querySelector('.chat-editing-session-actions') as HTMLElement ?? dom.append(overviewRegion, $('.chat-editing-session-actions'));

		this._chatEditsActionsDisposables.add(this.instantiationService.createInstance(MenuWorkbenchButtonBar, actionsContainer, MenuId.ChatEditingWidgetToolbar, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: {
				arg: { sessionId: chatEditingSession.chatSessionId },
			},
			buttonConfigProvider: (action) => {
				if (action.id === ChatEditingShowChangesAction.ID || action.id === ChatEditingRemoveAllFilesAction.ID) {
					return { showIcon: true, showLabel: false, isSecondary: true };
				}
				return undefined;
			}
		}));

		if (!chatEditingSession) {
			return;
		}

		// Working set
		const workingSetContainer = innerContainer.querySelector('.chat-editing-session-list') as HTMLElement ?? dom.append(innerContainer, $('.chat-editing-session-list'));
		if (!this._chatEditList) {
			this._chatEditList = this._chatEditsListPool.get();
			const list = this._chatEditList.object;
			this._chatEditsDisposables.add(this._chatEditList);
			this._chatEditsDisposables.add(list.onDidFocus(() => {
				this._onDidFocus.fire();
			}));
			this._chatEditsDisposables.add(list.onDidOpen(async (e) => {
				if (e.element?.kind === 'reference' && URI.isUri(e.element.reference)) {
					const modifiedFileUri = e.element.reference;

					const entry = chatEditingSession.getEntry(modifiedFileUri);

					const pane = await this.editorService.openEditor({
						resource: modifiedFileUri,
						options: e.editorOptions
					}, e.sideBySide ? SIDE_GROUP : ACTIVE_GROUP);

					if (pane) {
						entry?.getEditorIntegration(pane).reveal(true);
					}
				}
			}));
			this._chatEditsDisposables.add(addDisposableListener(list.getHTMLElement(), 'click', e => {
				if (!this.hasFocus()) {
					this._onDidFocus.fire();
				}
			}, true));
			dom.append(workingSetContainer, list.getHTMLElement());
			dom.append(innerContainer, workingSetContainer);
		}

		const maxItemsShown = 6;
		const itemsShown = Math.min(entries.length, maxItemsShown);
		const height = itemsShown * 22;
		const list = this._chatEditList.object;
		list.layout(height);
		list.getHTMLElement().style.height = `${height}px`;
		list.splice(0, list.length, entries);
		this._onDidChangeHeight.fire();
	}

	async renderChatRelatedFiles() {
		const anchor = this.relatedFilesContainer;
		dom.clearNode(anchor);
		const shouldRender = this.configurationService.getValue('chat.renderRelatedFiles');
		dom.setVisibility(Boolean(this.relatedFiles?.value.length && shouldRender), anchor);
		if (!shouldRender || !this.relatedFiles?.value.length) {
			return;
		}

		const hoverDelegate = getDefaultHoverDelegate('element');
		for (const { uri, description } of this.relatedFiles.value) {
			const uriLabel = this._chatEditsActionsDisposables.add(new Button(anchor, {
				supportIcons: true,
				secondary: true,
				hoverDelegate
			}));
			uriLabel.label = this.labelService.getUriBasenameLabel(uri);
			uriLabel.element.classList.add('monaco-icon-label');
			uriLabel.element.title = localize('suggeste.title', "{0} - {1}", this.labelService.getUriLabel(uri, { relative: true }), description ?? '');

			this._chatEditsActionsDisposables.add(uriLabel.onDidClick(async () => {
				group.remove(); // REMOVE asap
				await this._attachmentModel.addFile(uri);
				this.relatedFiles?.remove(uri);
			}));

			const addButton = this._chatEditsActionsDisposables.add(new Button(anchor, {
				supportIcons: false,
				secondary: true,
				hoverDelegate,
				ariaLabel: localize('chatEditingSession.addSuggestion', 'Add suggestion {0}', this.labelService.getUriLabel(uri, { relative: true })),
			}));
			addButton.icon = Codicon.add;
			addButton.setTitle(localize('chatEditingSession.addSuggested', 'Add suggestion'));
			this._chatEditsActionsDisposables.add(addButton.onDidClick(async () => {
				group.remove(); // REMOVE asap
				await this._attachmentModel.addFile(uri);
				this.relatedFiles?.remove(uri);
			}));

			const sep = document.createElement('div');
			sep.classList.add('separator');

			const group = document.createElement('span');
			group.classList.add('monaco-button-dropdown', 'sidebyside-button');
			group.appendChild(addButton.element);
			group.appendChild(sep);
			group.appendChild(uriLabel.element);
			dom.append(anchor, group);

			this._chatEditsActionsDisposables.add(toDisposable(() => {
				group.remove();
			}));
		}
		this._onDidChangeHeight.fire();
	}

	async renderFollowups(items: IChatFollowup[] | undefined, response: IChatResponseViewModel | undefined): Promise<void> {
		if (!this.options.renderFollowups) {
			return;
		}
		this.followupsDisposables.clear();
		dom.clearNode(this.followupsContainer);

		if (items && items.length > 0) {
			this.followupsDisposables.add(this.instantiationService.createInstance<typeof ChatFollowups<IChatFollowup>, ChatFollowups<IChatFollowup>>(ChatFollowups, this.followupsContainer, items, this.location, undefined, followup => this._onDidAcceptFollowup.fire({ followup, response })));
		}
		this._onDidChangeHeight.fire();
	}

	get contentHeight(): number {
		const data = this.getLayoutData();
		return data.followupsHeight + data.inputPartEditorHeight + data.inputPartVerticalPadding + data.inputEditorBorder + data.attachmentsHeight + data.toolbarsHeight + data.chatEditingStateHeight;
	}

	layout(height: number, width: number) {
		this.cachedDimensions = new dom.Dimension(width, height);

		return this._layout(height, width);
	}

	private previousInputEditorDimension: IDimension | undefined;
	private _layout(height: number, width: number, allowRecurse = true): void {
		const data = this.getLayoutData();
		const inputEditorHeight = Math.min(data.inputPartEditorHeight, height - data.followupsHeight - data.attachmentsHeight - data.inputPartVerticalPadding - data.toolbarsHeight);

		const followupsWidth = width - data.inputPartHorizontalPadding;
		this.followupsContainer.style.width = `${followupsWidth}px`;

		this._inputPartHeight = data.inputPartVerticalPadding + data.followupsHeight + inputEditorHeight + data.inputEditorBorder + data.attachmentsHeight + data.toolbarsHeight + data.chatEditingStateHeight;
		this._followupsHeight = data.followupsHeight;
		this._editSessionWidgetHeight = data.chatEditingStateHeight;

		const initialEditorScrollWidth = this._inputEditor.getScrollWidth();
		const newEditorWidth = width - data.inputPartHorizontalPadding - data.editorBorder - data.inputPartHorizontalPaddingInside - data.toolbarsWidth - data.sideToolbarWidth;
		const newDimension = { width: newEditorWidth, height: inputEditorHeight };
		if (!this.previousInputEditorDimension || (this.previousInputEditorDimension.width !== newDimension.width || this.previousInputEditorDimension.height !== newDimension.height)) {
			// This layout call has side-effects that are hard to understand. eg if we are calling this inside a onDidChangeContent handler, this can trigger the next onDidChangeContent handler
			// to be invoked, and we have a lot of these on this editor. Only doing a layout this when the editor size has actually changed makes it much easier to follow.
			this._inputEditor.layout(newDimension);
			this.previousInputEditorDimension = newDimension;
		}

		if (allowRecurse && initialEditorScrollWidth < 10) {
			// This is probably the initial layout. Now that the editor is layed out with its correct width, it should report the correct contentHeight
			return this._layout(height, width, false);
		}
	}

	private getLayoutData() {
		const executeToolbarWidth = this.cachedExecuteToolbarWidth = this.executeToolbar.getItemsWidth();
		const inputToolbarWidth = this.cachedInputToolbarWidth = this.inputActionsToolbar.getItemsWidth();
		const executeToolbarPadding = (this.executeToolbar.getItemsLength() - 1) * 4;
		const inputToolbarPadding = this.inputActionsToolbar.getItemsLength() ? (this.inputActionsToolbar.getItemsLength() - 1) * 4 : 0;
		return {
			inputEditorBorder: 2,
			followupsHeight: this.followupsContainer.offsetHeight,
			inputPartEditorHeight: Math.min(this._inputEditor.getContentHeight(), this.inputEditorMaxHeight),
			inputPartHorizontalPadding: this.options.renderStyle === 'compact' ? 16 : 32,
			inputPartVerticalPadding: this.options.renderStyle === 'compact' ? 12 : 28,
			attachmentsHeight: this.attachmentsContainer.offsetHeight + (this.attachmentsContainer.checkVisibility() ? 6 : 0),
			editorBorder: 2,
			inputPartHorizontalPaddingInside: 12,
			toolbarsWidth: this.options.renderStyle === 'compact' ? executeToolbarWidth + executeToolbarPadding + inputToolbarWidth + inputToolbarPadding : 0,
			toolbarsHeight: this.options.renderStyle === 'compact' ? 0 : 22,
			chatEditingStateHeight: this.chatEditingSessionWidgetContainer.offsetHeight,
			sideToolbarWidth: this.inputSideToolbarContainer ? dom.getTotalWidth(this.inputSideToolbarContainer) + 4 /*gap*/ : 0,
		};
	}

	getViewState(): IChatInputState {
		return this.getInputState();
	}

	saveState(): void {
		if (this.history.isAtEnd()) {
			this.saveCurrentValue(this.getInputState());
		}

		const inputHistory = [...this.history];
		this.historyService.saveHistory(this.location, inputHistory);
	}
}

const historyKeyFn = (entry: IChatHistoryEntry) => JSON.stringify({ ...entry, state: { ...entry.state, chatMode: undefined } });

function getLastPosition(model: ITextModel): IPosition {
	return { lineNumber: model.getLineCount(), column: model.getLineLength(model.getLineCount()) + 1 };
}

// This does seems like a lot just to customize an item with dropdown. This whole class exists just because we need an
// onDidChange listener on the submenu, which is apparently not needed in other cases.
class ChatSubmitDropdownActionItem extends DropdownWithPrimaryActionViewItem {
	constructor(
		action: MenuItemAction,
		dropdownAction: IAction,
		options: IDropdownWithPrimaryActionViewItemOptions,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IThemeService themeService: IThemeService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		super(
			action,
			dropdownAction,
			[],
			'',
			{
				...options,
				getKeyBinding: (action: IAction) => keybindingService.lookupKeybinding(action.id, contextKeyService)
			},
			contextMenuService,
			keybindingService,
			notificationService,
			contextKeyService,
			themeService,
			accessibilityService);
		const menu = menuService.createMenu(MenuId.ChatExecuteSecondary, contextKeyService);
		const setActions = () => {
			const secondary = getFlatActionBarActions(menu.getActions({ shouldForwardArgs: true }));
			this.update(dropdownAction, secondary);
		};
		setActions();
		this._register(menu.onDidChange(() => setActions()));
	}
}

interface ModelPickerDelegate {
	onDidChangeModel: Event<ILanguageModelChatMetadataAndIdentifier>;
	setModel(selectedModelId: ILanguageModelChatMetadataAndIdentifier): void;
	getModels(): ILanguageModelChatMetadataAndIdentifier[];
}

class ModelPickerActionViewItem extends DropdownMenuActionViewItemWithKeybinding {
	constructor(
		action: MenuItemAction,
		private currentLanguageModel: ILanguageModelChatMetadataAndIdentifier,
		private readonly delegate: ModelPickerDelegate,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService,
		@ICommandService commandService: ICommandService,
		@IMenuService menuService: IMenuService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		const modelActionsProvider: IActionProvider = {
			getActions: () => {
				const setLanguageModelAction = (entry: ILanguageModelChatMetadataAndIdentifier): IAction => {
					return {
						id: entry.identifier,
						label: entry.metadata.name,
						tooltip: '',
						class: undefined,
						enabled: true,
						checked: entry.identifier === this.currentLanguageModel.identifier,
						run: () => {
							this.currentLanguageModel = entry;
							this.renderLabel(this.element!);
							this.delegate.setModel(entry);
						}
					};
				};

				const models: ILanguageModelChatMetadataAndIdentifier[] = this.delegate.getModels();
				const actions = models.map(entry => setLanguageModelAction(entry));

				// Add menu contributions from extensions
				const menuActions = menuService.getMenuActions(MenuId.ChatModelPicker, contextKeyService);
				const menuContributions = getFlatActionBarActions(menuActions);
				if (menuContributions.length > 0 || chatEntitlementService.entitlement === ChatEntitlement.Limited) {
					actions.push(new Separator());
				}
				actions.push(...menuContributions);
				if (chatEntitlementService.entitlement === ChatEntitlement.Limited) {
					actions.push(toAction({
						id: 'moreModels', label: localize('chat.moreModels', "Add more Models"), run: () => {
							const commandId = 'workbench.action.chat.upgradePlan';
							telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: commandId, from: 'chat-models' });
							commandService.executeCommand(commandId);
						}
					}));
				}
				return actions;
			}
		};

		const actionWithLabel: IAction = {
			...action,
			tooltip: localize('chat.modelPicker.label', "Pick Model"),
			run: () => { }
		};
		super(actionWithLabel, modelActionsProvider, contextMenuService, undefined, keybindingService, contextKeyService);
		this._register(delegate.onDidChangeModel(modelId => {
			this.currentLanguageModel = modelId;
			this.renderLabel(this.element!);
		}));
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		this.setAriaLabelAttributes(element);
		dom.reset(element, dom.$('span.chat-model-label', undefined, this.currentLanguageModel.metadata.name), ...renderLabelWithIcons(`$(chevron-down)`));
		return null;
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('chat-modelPicker-item');
	}
}

const chatInputEditorContainerSelector = '.interactive-input-editor';
setupSimpleEditorSelectionStyling(chatInputEditorContainerSelector);

interface IModePickerDelegate {
	onDidChangeMode: Event<void>;
	getMode(): ChatMode;
}

class ToggleChatModeActionViewItem extends DropdownMenuActionViewItemWithKeybinding {
	constructor(
		action: MenuItemAction,
		private readonly delegate: IModePickerDelegate,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IChatService chatService: IChatService,
		@IChatAgentService chatAgentService: IChatAgentService,
	) {
		const makeAction = (mode: ChatMode): IAction => ({
			...action,
			id: mode,
			label: this.modeToString(mode),
			class: undefined,
			enabled: true,
			checked: delegate.getMode() === mode,
			run: async () => {
				const result = await action.run({ mode } satisfies IToggleChatModeArgs);
				this.renderLabel(this.element!);
				return result;
			}
		});

		const actionProvider: IActionProvider = {
			getActions: () => {
				const agentStateActions = [
					makeAction(ChatMode.Edit),
				];
				if (chatAgentService.hasToolsAgent) {
					agentStateActions.push(makeAction(ChatMode.Agent));
				}

				if (chatService.unifiedViewEnabled) {
					agentStateActions.unshift(makeAction(ChatMode.Ask));
				}

				return agentStateActions;
			}
		};

		super(action, actionProvider, contextMenuService, undefined, keybindingService, contextKeyService);
		this._register(delegate.onDidChangeMode(() => this.renderLabel(this.element!)));
	}

	private modeToString(mode: ChatMode) {
		switch (mode) {
			case ChatMode.Agent:
				return localize('chat.agentMode', "Agent");
			case ChatMode.Edit:
				return localize('chat.normalMode', "Edit");
			case ChatMode.Ask:
			default:
				return localize('chat.askMode', "Ask");
		}
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		// Can't call super.renderLabel because it has a hack of forcing the 'codicon' class
		this.setAriaLabelAttributes(element);

		const state = this.modeToString(this.delegate.getMode());
		dom.reset(element, dom.$('span.chat-model-label', undefined, state), ...renderLabelWithIcons(`$(chevron-down)`));
		return null;
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('chat-modelPicker-item');
	}
}

class AddFilesButton extends ActionViewItem {
	constructor(context: unknown, action: IAction, options: IActionViewItemOptions) {
		super(context, action, options);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('chat-attached-context-attachment', 'chat-add-files');
	}
}
