/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/interactive';
import * as DOM from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { ICodeEditorViewState } from 'vs/editor/common/editorCommon';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { EditorPaneSelectionChangeReason, IEditorMemento, IEditorOpenContext, IEditorPaneScrollPosition, IEditorPaneSelectionChangeEvent, IEditorPaneWithScrolling } from 'vs/workbench/common/editor';
import { getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { InteractiveEditorInput } from 'vs/workbench/contrib/interactive/browser/interactiveEditorInput';
import { ICellViewModel, INotebookEditorOptions, INotebookEditorViewState } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditorExtensionsRegistry } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { IBorrowValue, INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ExecutionStateCellStatusBarContrib, TimerCellStatusBarContrib } from 'vs/workbench/contrib/notebook/browser/contrib/cellStatusBar/executionStatusBarItemController';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { PLAINTEXT_LANGUAGE_ID } from 'vs/editor/common/languages/modesRegistry';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { InteractiveWindowSetting, INTERACTIVE_INPUT_CURSOR_BOUNDARY } from 'vs/workbench/contrib/interactive/browser/interactiveCommon';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/browser/notebookOptions';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { createActionViewItem, createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IAction } from 'vs/base/common/actions';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { ParameterHintsController } from 'vs/editor/contrib/parameterHints/browser/parameterHints';
import { MenuPreventer } from 'vs/workbench/contrib/codeEditor/browser/menuPreventer';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { TabCompletionController } from 'vs/workbench/contrib/snippets/browser/tabCompletion';
import { MarkerController } from 'vs/editor/contrib/gotoError/browser/gotoError';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfiguration';
import { ITextEditorOptions, TextEditorSelectionSource } from 'vs/platform/editor/common/editor';
import { INotebookExecutionStateService, NotebookExecutionType } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { NOTEBOOK_KERNEL } from 'vs/workbench/contrib/notebook/common/notebookContextKeys';
import { ICursorPositionChangedEvent } from 'vs/editor/common/cursorEvents';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { isEqual } from 'vs/base/common/resources';
import { NotebookFindContrib } from 'vs/workbench/contrib/notebook/browser/contrib/find/notebookFindWidget';
import { INTERACTIVE_WINDOW_EDITOR_ID } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import 'vs/css!./interactiveEditor';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { deepClone } from 'vs/base/common/objects';
import { HoverController } from 'vs/editor/contrib/hover/browser/hoverController';
import { ReplInputHintContentWidget } from 'vs/workbench/contrib/interactive/browser/replInputHintContentWidget';

const DECORATION_KEY = 'interactiveInputDecoration';
const INTERACTIVE_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'InteractiveEditorViewState';

const INPUT_CELL_VERTICAL_PADDING = 8;
const INPUT_CELL_HORIZONTAL_PADDING_RIGHT = 10;
const INPUT_EDITOR_PADDING = 8;


export interface InteractiveEditorViewState {
	readonly notebook?: INotebookEditorViewState;
	readonly input?: ICodeEditorViewState | null;
}

export interface InteractiveEditorOptions extends ITextEditorOptions {
	readonly viewState?: InteractiveEditorViewState;
}

export class InteractiveEditor extends EditorPane implements IEditorPaneWithScrolling {
	private _rootElement!: HTMLElement;
	private _styleElement!: HTMLStyleElement;
	private _notebookEditorContainer!: HTMLElement;
	private _notebookWidget: IBorrowValue<NotebookEditorWidget> = { value: undefined };
	private _inputCellContainer!: HTMLElement;
	private _inputFocusIndicator!: HTMLElement;
	private _inputRunButtonContainer!: HTMLElement;
	private _inputConfigContainer!: HTMLElement;
	private _inputEditorContainer!: HTMLElement;
	private _codeEditorWidget!: CodeEditorWidget;
	private _notebookWidgetService: INotebookEditorService;
	private _instantiationService: IInstantiationService;
	private _languageService: ILanguageService;
	private _contextKeyService: IContextKeyService;
	private _configurationService: IConfigurationService;
	private _notebookKernelService: INotebookKernelService;
	private _keybindingService: IKeybindingService;
	private _menuService: IMenuService;
	private _contextMenuService: IContextMenuService;
	private _editorGroupService: IEditorGroupsService;
	private _notebookExecutionStateService: INotebookExecutionStateService;
	private _extensionService: IExtensionService;
	private readonly _widgetDisposableStore: DisposableStore = this._register(new DisposableStore());
	private _lastLayoutDimensions?: { readonly dimension: DOM.Dimension; readonly position: DOM.IDomPosition };
	private _editorOptions: IEditorOptions;
	private _notebookOptions: NotebookOptions;
	private _editorMemento: IEditorMemento<InteractiveEditorViewState>;
	private readonly _groupListener = this._register(new MutableDisposable());
	private _runbuttonToolbar: ToolBar | undefined;
	private _hintElement: ReplInputHintContentWidget | undefined;

	private _onDidFocusWidget = this._register(new Emitter<void>());
	override get onDidFocus(): Event<void> { return this._onDidFocusWidget.event; }
	private _onDidChangeSelection = this._register(new Emitter<IEditorPaneSelectionChangeEvent>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;
	private _onDidChangeScroll = this._register(new Emitter<void>());
	readonly onDidChangeScroll = this._onDidChangeScroll.event;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotebookEditorService notebookWidgetService: INotebookEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@INotebookKernelService notebookKernelService: INotebookKernelService,
		@ILanguageService languageService: ILanguageService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@INotebookExecutionStateService notebookExecutionStateService: INotebookExecutionStateService,
		@IExtensionService extensionService: IExtensionService,
	) {
		super(
			INTERACTIVE_WINDOW_EDITOR_ID,
			group,
			telemetryService,
			themeService,
			storageService
		);
		this._instantiationService = instantiationService;
		this._notebookWidgetService = notebookWidgetService;
		this._contextKeyService = contextKeyService;
		this._configurationService = configurationService;
		this._notebookKernelService = notebookKernelService;
		this._languageService = languageService;
		this._keybindingService = keybindingService;
		this._menuService = menuService;
		this._contextMenuService = contextMenuService;
		this._editorGroupService = editorGroupService;
		this._notebookExecutionStateService = notebookExecutionStateService;
		this._extensionService = extensionService;

		this._editorOptions = this._computeEditorOptions();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor') || e.affectsConfiguration('notebook')) {
				this._editorOptions = this._computeEditorOptions();
			}
		}));
		this._notebookOptions = instantiationService.createInstance(NotebookOptions, this.window, true, { cellToolbarInteraction: 'hover', globalToolbar: true, stickyScrollEnabled: false, dragAndDropEnabled: false });
		this._editorMemento = this.getEditorMemento<InteractiveEditorViewState>(editorGroupService, textResourceConfigurationService, INTERACTIVE_EDITOR_VIEW_STATE_PREFERENCE_KEY);

		codeEditorService.registerDecorationType('interactive-decoration', DECORATION_KEY, {});
		this._register(this._keybindingService.onDidUpdateKeybindings(this._updateInputHint, this));
		this._register(this._notebookExecutionStateService.onDidChangeExecution((e) => {
			if (e.type === NotebookExecutionType.cell && isEqual(e.notebook, this._notebookWidget.value?.viewModel?.notebookDocument.uri)) {
				const cell = this._notebookWidget.value?.getCellByHandle(e.cellHandle);
				if (cell && e.changed?.state) {
					this._scrollIfNecessary(cell);
				}
			}
		}));
	}

	private get inputCellContainerHeight() {
		return 19 + 2 + INPUT_CELL_VERTICAL_PADDING * 2 + INPUT_EDITOR_PADDING * 2;
	}

	private get inputCellEditorHeight() {
		return 19 + INPUT_EDITOR_PADDING * 2;
	}

	protected createEditor(parent: HTMLElement): void {
		this._rootElement = DOM.append(parent, DOM.$('.interactive-editor'));
		this._rootElement.style.position = 'relative';
		this._notebookEditorContainer = DOM.append(this._rootElement, DOM.$('.notebook-editor-container'));
		this._inputCellContainer = DOM.append(this._rootElement, DOM.$('.input-cell-container'));
		this._inputCellContainer.style.position = 'absolute';
		this._inputCellContainer.style.height = `${this.inputCellContainerHeight}px`;
		this._inputFocusIndicator = DOM.append(this._inputCellContainer, DOM.$('.input-focus-indicator'));
		this._inputRunButtonContainer = DOM.append(this._inputCellContainer, DOM.$('.run-button-container'));
		this._setupRunButtonToolbar(this._inputRunButtonContainer);
		this._inputEditorContainer = DOM.append(this._inputCellContainer, DOM.$('.input-editor-container'));
		this._setupConfigButtonToolbar();
		this._createLayoutStyles();
	}

	private _setupConfigButtonToolbar() {
		this._inputConfigContainer = DOM.append(this._inputEditorContainer, DOM.$('.input-toolbar-container'));
		this._inputConfigContainer.style.position = 'absolute';
		this._inputConfigContainer.style.right = '0';
		this._inputConfigContainer.style.marginTop = '6px';
		this._inputConfigContainer.style.marginRight = '12px';
		this._inputConfigContainer.style.zIndex = '1';
		this._inputConfigContainer.style.display = 'none';

		const menu = this._register(this._menuService.createMenu(MenuId.InteractiveInputConfig, this._contextKeyService));
		const toolbar = this._register(new ToolBar(this._inputConfigContainer, this._contextMenuService, {
			getKeyBinding: action => this._keybindingService.lookupKeybinding(action.id),
			actionViewItemProvider: (action, options) => {
				return createActionViewItem(this._instantiationService, action, options);
			},
			renderDropdownAsChildElement: true
		}));

		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };

		createAndFillInActionBarActions(menu, { shouldForwardArgs: true }, result);
		toolbar.setActions([...primary, ...secondary]);
	}

	private _setupRunButtonToolbar(runButtonContainer: HTMLElement) {
		const menu = this._register(this._menuService.createMenu(MenuId.InteractiveInputExecute, this._contextKeyService));
		this._runbuttonToolbar = this._register(new ToolBar(runButtonContainer, this._contextMenuService, {
			getKeyBinding: action => this._keybindingService.lookupKeybinding(action.id),
			actionViewItemProvider: (action, options) => {
				return createActionViewItem(this._instantiationService, action, options);
			},
			renderDropdownAsChildElement: true
		}));

		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };

		createAndFillInActionBarActions(menu, { shouldForwardArgs: true }, result);
		this._runbuttonToolbar.setActions([...primary, ...secondary]);
	}

	private _createLayoutStyles(): void {
		this._styleElement = DOM.createStyleSheet(this._rootElement);
		const styleSheets: string[] = [];

		const {
			codeCellLeftMargin,
			cellRunGutter
		} = this._notebookOptions.getLayoutConfiguration();
		const {
			focusIndicator
		} = this._notebookOptions.getDisplayOptions();
		const leftMargin = this._notebookOptions.getCellEditorContainerLeftMargin();

		styleSheets.push(`
			.interactive-editor .input-cell-container {
				padding: ${INPUT_CELL_VERTICAL_PADDING}px ${INPUT_CELL_HORIZONTAL_PADDING_RIGHT}px ${INPUT_CELL_VERTICAL_PADDING}px ${leftMargin}px;
			}
		`);
		if (focusIndicator === 'gutter') {
			styleSheets.push(`
				.interactive-editor .input-cell-container:focus-within .input-focus-indicator::before {
					border-color: var(--vscode-notebook-focusedCellBorder) !important;
				}
				.interactive-editor .input-focus-indicator::before {
					border-color: var(--vscode-notebook-inactiveFocusedCellBorder) !important;
				}
				.interactive-editor .input-cell-container .input-focus-indicator {
					display: block;
					top: ${INPUT_CELL_VERTICAL_PADDING}px;
				}
				.interactive-editor .input-cell-container {
					border-top: 1px solid var(--vscode-notebook-inactiveFocusedCellBorder);
				}
			`);
		} else {
			// border
			styleSheets.push(`
				.interactive-editor .input-cell-container {
					border-top: 1px solid var(--vscode-notebook-inactiveFocusedCellBorder);
				}
				.interactive-editor .input-cell-container .input-focus-indicator {
					display: none;
				}
			`);
		}

		styleSheets.push(`
			.interactive-editor .input-cell-container .run-button-container {
				width: ${cellRunGutter}px;
				left: ${codeCellLeftMargin}px;
				margin-top: ${INPUT_EDITOR_PADDING - 2}px;
			}
		`);

		this._styleElement.textContent = styleSheets.join('\n');
	}

	private _computeEditorOptions(): IEditorOptions {
		let overrideIdentifier: string | undefined = undefined;
		if (this._codeEditorWidget) {
			overrideIdentifier = this._codeEditorWidget.getModel()?.getLanguageId();
		}
		const editorOptions = deepClone(this._configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier }));
		const editorOptionsOverride = getSimpleEditorOptions(this._configurationService);
		const computed = Object.freeze({
			...editorOptions,
			...editorOptionsOverride,
			...{
				glyphMargin: true,
				padding: {
					top: INPUT_EDITOR_PADDING,
					bottom: INPUT_EDITOR_PADDING
				},
				hover: {
					enabled: true
				}
			}
		});

		return computed;
	}

	protected override saveState(): void {
		this._saveEditorViewState(this.input);
		super.saveState();
	}

	override getViewState(): InteractiveEditorViewState | undefined {
		const input = this.input;
		if (!(input instanceof InteractiveEditorInput)) {
			return undefined;
		}

		this._saveEditorViewState(input);
		return this._loadNotebookEditorViewState(input);
	}

	private _saveEditorViewState(input: EditorInput | undefined): void {
		if (this._notebookWidget.value && input instanceof InteractiveEditorInput) {
			if (this._notebookWidget.value.isDisposed) {
				return;
			}

			const state = this._notebookWidget.value.getEditorViewState();
			const editorState = this._codeEditorWidget.saveViewState();
			this._editorMemento.saveEditorState(this.group, input.notebookEditorInput.resource, {
				notebook: state,
				input: editorState
			});
		}
	}

	private _loadNotebookEditorViewState(input: InteractiveEditorInput): InteractiveEditorViewState | undefined {
		const result = this._editorMemento.loadEditorState(this.group, input.notebookEditorInput.resource);
		if (result) {
			return result;
		}
		// when we don't have a view state for the group/input-tuple then we try to use an existing
		// editor for the same resource.
		for (const group of this._editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			if (group.activeEditorPane !== this && group.activeEditorPane === this && group.activeEditor?.matches(input)) {
				const notebook = this._notebookWidget.value?.getEditorViewState();
				const input = this._codeEditorWidget.saveViewState();
				return {
					notebook,
					input
				};
			}
		}
		return;
	}

	override async setInput(input: InteractiveEditorInput, options: InteractiveEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		const notebookInput = input.notebookEditorInput;

		// there currently is a widget which we still own so
		// we need to hide it before getting a new widget
		this._notebookWidget.value?.onWillHide();

		this._codeEditorWidget?.dispose();

		this._widgetDisposableStore.clear();

		this._notebookWidget = <IBorrowValue<NotebookEditorWidget>>this._instantiationService.invokeFunction(this._notebookWidgetService.retrieveWidget, this.group, notebookInput, {
			isEmbedded: true,
			isReadOnly: true,
			contributions: NotebookEditorExtensionsRegistry.getSomeEditorContributions([
				ExecutionStateCellStatusBarContrib.id,
				TimerCellStatusBarContrib.id,
				NotebookFindContrib.id
			]),
			menuIds: {
				notebookToolbar: MenuId.InteractiveToolbar,
				cellTitleToolbar: MenuId.InteractiveCellTitle,
				cellDeleteToolbar: MenuId.InteractiveCellDelete,
				cellInsertToolbar: MenuId.NotebookCellBetween,
				cellTopInsertToolbar: MenuId.NotebookCellListTop,
				cellExecuteToolbar: MenuId.InteractiveCellExecute,
				cellExecutePrimary: undefined
			},
			cellEditorContributions: EditorExtensionsRegistry.getSomeEditorContributions([
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				HoverController.ID,
				MarkerController.ID
			]),
			options: this._notebookOptions,
			codeWindow: this.window
		}, undefined, this.window);

		this._codeEditorWidget = this._instantiationService.createInstance(CodeEditorWidget, this._inputEditorContainer, this._editorOptions, {
			...{
				isSimpleWidget: false,
				contributions: EditorExtensionsRegistry.getSomeEditorContributions([
					MenuPreventer.ID,
					SelectionClipboardContributionID,
					ContextMenuController.ID,
					SuggestController.ID,
					ParameterHintsController.ID,
					SnippetController2.ID,
					TabCompletionController.ID,
					HoverController.ID,
					MarkerController.ID
				])
			}
		});

		if (this._lastLayoutDimensions) {
			this._notebookEditorContainer.style.height = `${this._lastLayoutDimensions.dimension.height - this.inputCellContainerHeight}px`;
			this._notebookWidget.value!.layout(new DOM.Dimension(this._lastLayoutDimensions.dimension.width, this._lastLayoutDimensions.dimension.height - this.inputCellContainerHeight), this._notebookEditorContainer);
			const leftMargin = this._notebookOptions.getCellEditorContainerLeftMargin();
			const maxHeight = Math.min(this._lastLayoutDimensions.dimension.height / 2, this.inputCellEditorHeight);
			this._codeEditorWidget.layout(this._validateDimension(this._lastLayoutDimensions.dimension.width - leftMargin - INPUT_CELL_HORIZONTAL_PADDING_RIGHT, maxHeight));
			this._inputFocusIndicator.style.height = `${this.inputCellEditorHeight}px`;
			this._inputCellContainer.style.top = `${this._lastLayoutDimensions.dimension.height - this.inputCellContainerHeight}px`;
			this._inputCellContainer.style.width = `${this._lastLayoutDimensions.dimension.width}px`;
		}

		await super.setInput(input, options, context, token);
		const model = await input.resolve();
		if (this._runbuttonToolbar) {
			this._runbuttonToolbar.context = input.resource;
		}

		if (model === null) {
			throw new Error('The Interactive Window model could not be resolved');
		}

		this._notebookWidget.value?.setParentContextKeyService(this._contextKeyService);

		const viewState = options?.viewState ?? this._loadNotebookEditorViewState(input);
		await this._extensionService.whenInstalledExtensionsRegistered();
		await this._notebookWidget.value!.setModel(model.notebook, viewState?.notebook);
		model.notebook.setCellCollapseDefault(this._notebookOptions.getCellCollapseDefault());
		this._notebookWidget.value!.setOptions({
			isReadOnly: true
		});
		this._widgetDisposableStore.add(this._notebookWidget.value!.onDidResizeOutput((cvm) => {
			this._scrollIfNecessary(cvm);
		}));
		this._widgetDisposableStore.add(this._notebookWidget.value!.onDidFocusWidget(() => this._onDidFocusWidget.fire()));
		this._widgetDisposableStore.add(this._notebookOptions.onDidChangeOptions(e => {
			if (e.compactView || e.focusIndicator) {
				// update the styling
				this._styleElement?.remove();
				this._createLayoutStyles();
			}

			if (this._lastLayoutDimensions && this.isVisible()) {
				this.layout(this._lastLayoutDimensions.dimension, this._lastLayoutDimensions.position);
			}

			if (e.interactiveWindowCollapseCodeCells) {
				model.notebook.setCellCollapseDefault(this._notebookOptions.getCellCollapseDefault());
			}
		}));

		const languageId = this._notebookWidget.value?.activeKernel?.supportedLanguages[0] ?? input.language ?? PLAINTEXT_LANGUAGE_ID;
		const editorModel = await input.resolveInput(languageId);
		editorModel.setLanguage(languageId);
		this._codeEditorWidget.setModel(editorModel);
		if (viewState?.input) {
			this._codeEditorWidget.restoreViewState(viewState.input);
		}
		this._editorOptions = this._computeEditorOptions();
		this._codeEditorWidget.updateOptions(this._editorOptions);

		this._widgetDisposableStore.add(this._codeEditorWidget.onDidFocusEditorWidget(() => this._onDidFocusWidget.fire()));
		this._widgetDisposableStore.add(this._codeEditorWidget.onDidContentSizeChange(e => {
			if (!e.contentHeightChanged) {
				return;
			}

			if (this._lastLayoutDimensions) {
				this._layoutWidgets(this._lastLayoutDimensions.dimension, this._lastLayoutDimensions.position);
			}
		}));

		this._widgetDisposableStore.add(this._codeEditorWidget.onDidChangeCursorPosition(e => this._onDidChangeSelection.fire({ reason: this._toEditorPaneSelectionChangeReason(e) })));
		this._widgetDisposableStore.add(this._codeEditorWidget.onDidChangeModelContent(() => this._onDidChangeSelection.fire({ reason: EditorPaneSelectionChangeReason.EDIT })));


		this._widgetDisposableStore.add(this._notebookKernelService.onDidChangeNotebookAffinity(this._syncWithKernel, this));
		this._widgetDisposableStore.add(this._notebookKernelService.onDidChangeSelectedNotebooks(this._syncWithKernel, this));

		this._widgetDisposableStore.add(this.themeService.onDidColorThemeChange(() => {
			if (this.isVisible()) {
				this._updateInputHint();
			}
		}));

		this._widgetDisposableStore.add(this._codeEditorWidget.onDidChangeModelContent(() => {
			if (this.isVisible()) {
				this._updateInputHint();
			}
		}));

		this._widgetDisposableStore.add(this._codeEditorWidget.onDidChangeModel(() => {
			this._updateInputHint();
		}));

		this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(InteractiveWindowSetting.showExecutionHint)) {
				this._updateInputHint();
			}
		});

		const cursorAtBoundaryContext = INTERACTIVE_INPUT_CURSOR_BOUNDARY.bindTo(this._contextKeyService);
		if (input.resource && input.historyService.has(input.resource)) {
			cursorAtBoundaryContext.set('top');
		} else {
			cursorAtBoundaryContext.set('none');
		}

		this._widgetDisposableStore.add(this._codeEditorWidget.onDidChangeCursorPosition(({ position }) => {
			const viewModel = this._codeEditorWidget._getViewModel()!;
			const lastLineNumber = viewModel.getLineCount();
			const lastLineCol = viewModel.getLineLength(lastLineNumber) + 1;
			const viewPosition = viewModel.coordinatesConverter.convertModelPositionToViewPosition(position);
			const firstLine = viewPosition.lineNumber === 1 && viewPosition.column === 1;
			const lastLine = viewPosition.lineNumber === lastLineNumber && viewPosition.column === lastLineCol;

			if (firstLine) {
				if (lastLine) {
					cursorAtBoundaryContext.set('both');
				} else {
					cursorAtBoundaryContext.set('top');
				}
			} else {
				if (lastLine) {
					cursorAtBoundaryContext.set('bottom');
				} else {
					cursorAtBoundaryContext.set('none');
				}
			}
		}));

		this._widgetDisposableStore.add(editorModel.onDidChangeContent(() => {
			const value = editorModel.getValue();
			if (this.input?.resource && value !== '') {
				(this.input as InteractiveEditorInput).historyService.replaceLast(this.input.resource, value);
			}
		}));

		this._widgetDisposableStore.add(this._notebookWidget.value!.onDidScroll(() => this._onDidChangeScroll.fire()));

		this._syncWithKernel();

		this._updateInputHint();
	}

	override setOptions(options: INotebookEditorOptions | undefined): void {
		this._notebookWidget.value?.setOptions(options);
		super.setOptions(options);
	}

	private _toEditorPaneSelectionChangeReason(e: ICursorPositionChangedEvent): EditorPaneSelectionChangeReason {
		switch (e.source) {
			case TextEditorSelectionSource.PROGRAMMATIC: return EditorPaneSelectionChangeReason.PROGRAMMATIC;
			case TextEditorSelectionSource.NAVIGATION: return EditorPaneSelectionChangeReason.NAVIGATION;
			case TextEditorSelectionSource.JUMP: return EditorPaneSelectionChangeReason.JUMP;
			default: return EditorPaneSelectionChangeReason.USER;
		}
	}

	private _cellAtBottom(cell: ICellViewModel): boolean {
		const visibleRanges = this._notebookWidget.value?.visibleRanges || [];
		const cellIndex = this._notebookWidget.value?.getCellIndex(cell);
		if (cellIndex === Math.max(...visibleRanges.map(range => range.end - 1))) {
			return true;
		}
		return false;
	}

	private _scrollIfNecessary(cvm: ICellViewModel) {
		const index = this._notebookWidget.value!.getCellIndex(cvm);
		if (index === this._notebookWidget.value!.getLength() - 1) {
			// If we're already at the bottom or auto scroll is enabled, scroll to the bottom
			if (this._configurationService.getValue<boolean>(InteractiveWindowSetting.interactiveWindowAlwaysScrollOnNewCell) || this._cellAtBottom(cvm)) {
				this._notebookWidget.value!.scrollToBottom();
			}
		}
	}

	private _syncWithKernel() {
		const notebook = this._notebookWidget.value?.textModel;
		const textModel = this._codeEditorWidget.getModel();

		if (notebook && textModel) {
			const info = this._notebookKernelService.getMatchingKernel(notebook);
			const selectedOrSuggested = info.selected
				?? (info.suggestions.length === 1 ? info.suggestions[0] : undefined)
				?? (info.all.length === 1 ? info.all[0] : undefined);

			if (selectedOrSuggested) {
				const language = selectedOrSuggested.supportedLanguages[0];
				// All kernels will initially list plaintext as the supported language before they properly initialized.
				if (language && language !== 'plaintext') {
					const newMode = this._languageService.createById(language).languageId;
					textModel.setLanguage(newMode);
				}

				NOTEBOOK_KERNEL.bindTo(this._contextKeyService).set(selectedOrSuggested.id);
			}
		}
	}

	layout(dimension: DOM.Dimension, position: DOM.IDomPosition): void {
		this._rootElement.classList.toggle('mid-width', dimension.width < 1000 && dimension.width >= 600);
		this._rootElement.classList.toggle('narrow-width', dimension.width < 600);
		const editorHeightChanged = dimension.height !== this._lastLayoutDimensions?.dimension.height;
		this._lastLayoutDimensions = { dimension, position };

		if (!this._notebookWidget.value) {
			return;
		}

		if (editorHeightChanged && this._codeEditorWidget) {
			SuggestController.get(this._codeEditorWidget)?.cancelSuggestWidget();
		}

		this._notebookEditorContainer.style.height = `${this._lastLayoutDimensions.dimension.height - this.inputCellContainerHeight}px`;
		this._layoutWidgets(dimension, position);
	}

	private _layoutWidgets(dimension: DOM.Dimension, position: DOM.IDomPosition) {
		const contentHeight = this._codeEditorWidget.hasModel() ? this._codeEditorWidget.getContentHeight() : this.inputCellEditorHeight;
		const maxHeight = Math.min(dimension.height / 2, contentHeight);
		const leftMargin = this._notebookOptions.getCellEditorContainerLeftMargin();

		const inputCellContainerHeight = maxHeight + INPUT_CELL_VERTICAL_PADDING * 2;
		this._notebookEditorContainer.style.height = `${dimension.height - inputCellContainerHeight}px`;

		this._notebookWidget.value!.layout(dimension.with(dimension.width, dimension.height - inputCellContainerHeight), this._notebookEditorContainer, position);
		this._codeEditorWidget.layout(this._validateDimension(dimension.width - leftMargin - INPUT_CELL_HORIZONTAL_PADDING_RIGHT, maxHeight));
		this._inputFocusIndicator.style.height = `${contentHeight}px`;
		this._inputCellContainer.style.top = `${dimension.height - inputCellContainerHeight}px`;
		this._inputCellContainer.style.width = `${dimension.width}px`;
	}

	private _validateDimension(width: number, height: number) {
		return new DOM.Dimension(Math.max(0, width), Math.max(0, height));
	}

	private _updateInputHint(): void {
		if (!this._codeEditorWidget) {
			return;
		}

		const shouldHide =
			!this._codeEditorWidget.hasModel() ||
			this._configurationService.getValue<boolean>(InteractiveWindowSetting.showExecutionHint) === false ||
			this._codeEditorWidget.getModel()!.getValueLength() !== 0;

		if (!this._hintElement && !shouldHide) {
			this._hintElement = this._instantiationService.createInstance(ReplInputHintContentWidget, this._codeEditorWidget);
			this._inputConfigContainer.style.display = 'block';
		} else if (this._hintElement && shouldHide) {
			this._hintElement.dispose();
			this._hintElement = undefined;
			this._inputConfigContainer.style.display = 'none';
		}
	}

	getScrollPosition(): IEditorPaneScrollPosition {
		return {
			scrollTop: this._notebookWidget.value?.scrollTop ?? 0,
			scrollLeft: 0
		};
	}

	setScrollPosition(position: IEditorPaneScrollPosition): void {
		this._notebookWidget.value?.setScrollTop(position.scrollTop);
	}

	override focus() {
		super.focus();

		this._notebookWidget.value?.onShow();
		this._codeEditorWidget.focus();
	}

	focusHistory() {
		this._notebookWidget.value!.focus();
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		this._groupListener.value = this.group.onWillCloseEditor(e => this._saveEditorViewState(e.editor));

		if (!visible) {
			this._saveEditorViewState(this.input);
			if (this.input && this._notebookWidget.value) {
				this._notebookWidget.value.onWillHide();
			}
		}

		this._updateInputHint();
	}

	override clearInput() {
		if (this._notebookWidget.value) {
			this._saveEditorViewState(this.input);
			this._notebookWidget.value.onWillHide();
		}

		this._codeEditorWidget?.dispose();

		this._notebookWidget = { value: undefined };
		this._widgetDisposableStore.clear();

		super.clearInput();
	}

	override getControl(): { notebookEditor: NotebookEditorWidget | undefined; codeEditor: CodeEditorWidget } {
		return {
			notebookEditor: this._notebookWidget.value,
			codeEditor: this._codeEditorWidget
		};
	}
}
