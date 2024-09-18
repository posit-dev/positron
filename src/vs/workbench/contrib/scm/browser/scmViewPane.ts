/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/scm';
import { Event, Emitter } from 'vs/base/common/event';
import { basename, dirname } from 'vs/base/common/resources';
import { IDisposable, Disposable, DisposableStore, combinedDisposable, dispose, toDisposable, MutableDisposable, DisposableMap } from 'vs/base/common/lifecycle';
import { ViewPane, IViewPaneOptions, ViewAction } from 'vs/workbench/browser/parts/views/viewPane';
import { append, $, Dimension, asCSSUrl, trackFocus, clearNode, prepend, isPointerEvent, isActiveElement } from 'vs/base/browser/dom';
import { IListVirtualDelegate, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { ISCMHistoryItem, ISCMHistoryItemChange, ISCMHistoryItemViewModel, SCMHistoryItemViewModelTreeElement, ISCMHistoryProviderCacheEntry, SCMHistoryItemChangeTreeElement, SCMHistoryItemGroupTreeElement, SCMHistoryItemTreeElement, SCMViewSeparatorElement } from 'vs/workbench/contrib/scm/common/history';
import { ISCMResourceGroup, ISCMResource, InputValidationType, ISCMRepository, ISCMInput, IInputValidation, ISCMViewService, ISCMViewVisibleRepositoryChangeEvent, ISCMService, SCMInputChangeReason, VIEW_PANE_ID, ISCMActionButton, ISCMActionButtonDescriptor, ISCMRepositorySortKey, ISCMInputValueProviderContext, ISCMProvider } from 'vs/workbench/contrib/scm/common/scm';
import { ResourceLabels, IResourceLabel, IFileLabelOptions } from 'vs/workbench/browser/labels';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService, IContextMenuService, IOpenContextView } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey, ContextKeyExpr, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MenuItemAction, IMenuService, registerAction2, MenuId, IAction2Options, MenuRegistry, Action2, IMenu } from 'vs/platform/actions/common/actions';
import { IAction, ActionRunner, Action, Separator, IActionRunner, toAction } from 'vs/base/common/actions';
import { ActionBar, IActionViewItemProvider } from 'vs/base/browser/ui/actionbar/actionbar';
import { IThemeService, IFileIconTheme, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { isSCMResource, isSCMResourceGroup, connectPrimaryMenuToInlineActionBar, isSCMRepository, isSCMInput, collectContextMenuActions, getActionViewItemProvider, isSCMActionButton, isSCMViewService, isSCMHistoryItemGroupTreeElement, isSCMHistoryItemTreeElement, isSCMHistoryItemChangeTreeElement, toDiffEditorArguments, isSCMResourceNode, isSCMHistoryItemChangeNode, isSCMViewSeparator, connectPrimaryMenu, isSCMHistoryItemViewModelTreeElement } from './util';
import { WorkbenchCompressibleAsyncDataTree, IOpenEvent } from 'vs/platform/list/browser/listService';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { disposableTimeout, Sequencer, ThrottledDelayer, Throttler } from 'vs/base/common/async';
import { ITreeNode, ITreeFilter, ITreeSorter, ITreeContextMenuEvent, ITreeDragAndDrop, ITreeDragOverReaction, IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { ResourceTree, IResourceNode } from 'vs/base/common/resourceTree';
import { ICompressibleTreeRenderer, ICompressibleKeyboardNavigationLabelProvider } from 'vs/base/browser/ui/tree/objectTree';
import { Iterable } from 'vs/base/common/iterator';
import { ICompressedTreeNode } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import { URI } from 'vs/base/common/uri';
import { FileKind } from 'vs/platform/files/common/files';
import { compareFileNames, comparePaths } from 'vs/base/common/comparers';
import { FuzzyScore, createMatches, IMatch } from 'vs/base/common/filters';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { localize } from 'vs/nls';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { IModelService } from 'vs/editor/common/services/model';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MenuPreventer } from 'vs/workbench/contrib/codeEditor/browser/menuPreventer';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { EditorDictation } from 'vs/workbench/contrib/codeEditor/browser/dictation/editorDictation';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import * as platform from 'vs/base/common/platform';
import { compare, format } from 'vs/base/common/strings';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ColorDetector } from 'vs/editor/contrib/colorPicker/browser/colorDetector';
import { LinkDetector } from 'vs/editor/contrib/links/browser/links';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { ILabelService } from 'vs/platform/label/common/label';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DEFAULT_FONT_FAMILY } from 'vs/base/browser/fonts';
import { Codicon } from 'vs/base/common/codicons';
import { ThemeIcon } from 'vs/base/common/themables';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { RepositoryActionRunner, RepositoryRenderer } from 'vs/workbench/contrib/scm/browser/scmRepositoryRenderer';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { LabelFuzzyScore } from 'vs/base/browser/ui/tree/abstractTree';
import { Selection } from 'vs/editor/common/core/selection';
import { API_OPEN_DIFF_EDITOR_COMMAND_ID, API_OPEN_EDITOR_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { createActionViewItem, createAndFillInActionBarActions, createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { MarkdownRenderer, openLinkFromMarkdown } from 'vs/editor/browser/widget/markdownRenderer/browser/markdownRenderer';
import { Button, ButtonWithDescription, ButtonWithDropdown } from 'vs/base/browser/ui/button/button';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { RepositoryContextKeys } from 'vs/workbench/contrib/scm/browser/scmViewService';
import { DragAndDropController } from 'vs/editor/contrib/dnd/browser/dnd';
import { CopyPasteController } from 'vs/editor/contrib/dropOrPasteInto/browser/copyPasteController';
import { DropIntoEditorController } from 'vs/editor/contrib/dropOrPasteInto/browser/dropIntoEditorController';
import { MessageController } from 'vs/editor/contrib/message/browser/messageController';
import { defaultButtonStyles, defaultCountBadgeStyles } from 'vs/platform/theme/browser/defaultStyles';
import { InlineCompletionsController } from 'vs/editor/contrib/inlineCompletions/browser/inlineCompletionsController';
import { CodeActionController } from 'vs/editor/contrib/codeAction/browser/codeActionController';
import { Schemas } from 'vs/base/common/network';
import { IDragAndDropData } from 'vs/base/browser/dnd';
import { fillEditorsDragData } from 'vs/workbench/browser/dnd';
import { ElementsDragAndDropData, ListViewTargetSector } from 'vs/base/browser/ui/list/listView';
import { CodeDataTransfers } from 'vs/platform/dnd/browser/dnd';
import { FormatOnType } from 'vs/editor/contrib/format/browser/formatActions';
import { EditorOption, EditorOptions, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IAsyncDataTreeViewState, ITreeCompressionDelegate } from 'vs/base/browser/ui/tree/asyncDataTree';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { stripIcons } from 'vs/base/common/iconLabels';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { ColorIdentifier, editorSelectionBackground, foreground, inputBackground, inputForeground, listActiveSelectionForeground, registerColor, selectionBackground, transparent } from 'vs/platform/theme/common/colorRegistry';
import { IMenuWorkbenchToolBarOptions, WorkbenchToolBar } from 'vs/platform/actions/browser/toolbar';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { DropdownWithPrimaryActionViewItem } from 'vs/platform/actions/browser/dropdownWithPrimaryActionViewItem';
import { clamp, rot } from 'vs/base/common/numbers';
import { MarkdownString } from 'vs/base/common/htmlContent';
import type { IHoverOptions, IManagedHover, IManagedHoverTooltipMarkdownString } from 'vs/base/browser/ui/hover/hover';
import { IHoverService, WorkbenchHoverDelegate } from 'vs/platform/hover/browser/hover';
import { OpenScmGroupAction } from 'vs/workbench/contrib/multiDiffEditor/browser/scmMultiDiffSourceResolver';
import { HoverController } from 'vs/editor/contrib/hover/browser/hoverController';
import { ITextModel } from 'vs/editor/common/model';
import { autorun } from 'vs/base/common/observable';
import { createInstantHoverDelegate, getDefaultHoverDelegate } from 'vs/base/browser/ui/hover/hoverDelegateFactory';
import { historyItemGroupBase, historyItemGroupHoverLabelForeground, historyItemGroupLocal, historyItemGroupRemote, renderSCMHistoryItemGraph, toISCMHistoryItemViewModelArray } from 'vs/workbench/contrib/scm/browser/scmHistory';
import { PlaceholderTextContribution } from 'vs/editor/contrib/placeholderText/browser/placeholderTextContribution';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import { IHoverDelegate } from 'vs/base/browser/ui/hover/hoverDelegate';
import { IWorkbenchLayoutService, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { fromNow } from 'vs/base/common/date';
import { equals } from 'vs/base/common/arrays';

// type SCMResourceTreeNode = IResourceNode<ISCMResource, ISCMResourceGroup>;
// type SCMHistoryItemChangeResourceTreeNode = IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>;
type TreeElement =
	ISCMRepository |
	ISCMInput |
	ISCMActionButton |
	ISCMResourceGroup |
	ISCMResource |
	IResourceNode<ISCMResource, ISCMResourceGroup> |
	SCMHistoryItemGroupTreeElement |
	SCMHistoryItemTreeElement |
	SCMHistoryItemViewModelTreeElement |
	SCMHistoryItemChangeTreeElement |
	IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement> |
	SCMViewSeparatorElement;

type ShowChangesSetting = 'always' | 'never' | 'auto';

const historyItemAdditionsForeground = registerColor('scm.historyItemAdditionsForeground', 'gitDecoration.addedResourceForeground', localize('scm.historyItemAdditionsForeground', "History item additions foreground color."));

const historyItemDeletionsForeground = registerColor('scm.historyItemDeletionsForeground', 'gitDecoration.deletedResourceForeground', localize('scm.historyItemDeletionsForeground', "History item deletions foreground color."));

registerColor('scm.historyItemStatisticsBorder', transparent(foreground, 0.2), localize('scm.historyItemStatisticsBorder', "History item statistics border color."));

registerColor('scm.historyItemSelectedStatisticsBorder', transparent(listActiveSelectionForeground, 0.2), localize('scm.historyItemSelectedStatisticsBorder', "History item selected statistics border color."));

function processResourceFilterData(uri: URI, filterData: FuzzyScore | LabelFuzzyScore | undefined): [IMatch[] | undefined, IMatch[] | undefined] {
	if (!filterData) {
		return [undefined, undefined];
	}

	if (!(filterData as LabelFuzzyScore).label) {
		const matches = createMatches(filterData as FuzzyScore);
		return [matches, undefined];
	}

	const fileName = basename(uri);
	const label = (filterData as LabelFuzzyScore).label;
	const pathLength = label.length - fileName.length;
	const matches = createMatches((filterData as LabelFuzzyScore).score);

	// FileName match
	if (label === fileName) {
		return [matches, undefined];
	}

	// FilePath match
	const labelMatches: IMatch[] = [];
	const descriptionMatches: IMatch[] = [];

	for (const match of matches) {
		if (match.start > pathLength) {
			// Label match
			labelMatches.push({
				start: match.start - pathLength,
				end: match.end - pathLength
			});
		} else if (match.end < pathLength) {
			// Description match
			descriptionMatches.push(match);
		} else {
			// Spanning match
			labelMatches.push({
				start: 0,
				end: match.end - pathLength
			});
			descriptionMatches.push({
				start: match.start,
				end: pathLength
			});
		}
	}

	return [labelMatches, descriptionMatches];
}

interface ISCMLayout {
	height: number | undefined;
	width: number | undefined;
	readonly onDidChange: Event<void>;
}

interface ActionButtonTemplate {
	readonly actionButton: SCMActionButton;
	disposable: IDisposable;
	readonly templateDisposable: IDisposable;
}

export class ActionButtonRenderer implements ICompressibleTreeRenderer<ISCMActionButton, FuzzyScore, ActionButtonTemplate> {
	static readonly DEFAULT_HEIGHT = 30;

	static readonly TEMPLATE_ID = 'actionButton';
	get templateId(): string { return ActionButtonRenderer.TEMPLATE_ID; }

	private actionButtons = new Map<ISCMActionButton, SCMActionButton>();

	constructor(
		@ICommandService private commandService: ICommandService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@INotificationService private notificationService: INotificationService,
	) { }

	renderTemplate(container: HTMLElement): ActionButtonTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-no-twistie');

		// Use default cursor & disable hover for list item
		container.parentElement!.parentElement!.classList.add('cursor-default', 'force-no-hover');

		const buttonContainer = append(container, $('.button-container'));
		const actionButton = new SCMActionButton(buttonContainer, this.contextMenuService, this.commandService, this.notificationService);

		return { actionButton, disposable: Disposable.None, templateDisposable: actionButton };
	}

	renderElement(node: ITreeNode<ISCMActionButton, FuzzyScore>, index: number, templateData: ActionButtonTemplate, height: number | undefined): void {
		templateData.disposable.dispose();

		const disposables = new DisposableStore();
		const actionButton = node.element;
		templateData.actionButton.setButton(node.element.button);

		// Remember action button
		this.actionButtons.set(actionButton, templateData.actionButton);
		disposables.add({ dispose: () => this.actionButtons.delete(actionButton) });

		templateData.disposable = disposables;
	}

	renderCompressedElements(): void {
		throw new Error('Should never happen since node is incompressible');
	}

	focusActionButton(actionButton: ISCMActionButton): void {
		this.actionButtons.get(actionButton)?.focus();
	}

	disposeElement(node: ITreeNode<ISCMActionButton, FuzzyScore>, index: number, template: ActionButtonTemplate): void {
		template.disposable.dispose();
	}

	disposeTemplate(templateData: ActionButtonTemplate): void {
		templateData.disposable.dispose();
		templateData.templateDisposable.dispose();
	}
}


class SCMTreeDragAndDrop implements ITreeDragAndDrop<TreeElement> {
	constructor(private readonly instantiationService: IInstantiationService) { }

	getDragURI(element: TreeElement): string | null {
		if (isSCMResource(element)) {
			return element.sourceUri.toString();
		}

		return null;
	}

	onDragStart(data: IDragAndDropData, originalEvent: DragEvent): void {
		const items = SCMTreeDragAndDrop.getResourcesFromDragAndDropData(data as ElementsDragAndDropData<TreeElement, TreeElement[]>);
		if (originalEvent.dataTransfer && items?.length) {
			this.instantiationService.invokeFunction(accessor => fillEditorsDragData(accessor, items, originalEvent));

			const fileResources = items.filter(s => s.scheme === Schemas.file).map(r => r.fsPath);
			if (fileResources.length) {
				originalEvent.dataTransfer.setData(CodeDataTransfers.FILES, JSON.stringify(fileResources));
			}
		}
	}

	getDragLabel(elements: TreeElement[], originalEvent: DragEvent): string | undefined {
		if (elements.length === 1) {
			const element = elements[0];
			if (isSCMResource(element)) {
				return basename(element.sourceUri);
			}
		}

		return String(elements.length);
	}

	onDragOver(data: IDragAndDropData, targetElement: TreeElement | undefined, targetIndex: number | undefined, targetSector: ListViewTargetSector | undefined, originalEvent: DragEvent): boolean | ITreeDragOverReaction {
		return true;
	}

	drop(data: IDragAndDropData, targetElement: TreeElement | undefined, targetIndex: number | undefined, targetSector: ListViewTargetSector | undefined, originalEvent: DragEvent): void { }

	private static getResourcesFromDragAndDropData(data: ElementsDragAndDropData<TreeElement, TreeElement[]>): URI[] {
		const uris: URI[] = [];
		for (const element of [...data.context ?? [], ...data.elements]) {
			if (isSCMResource(element)) {
				uris.push(element.sourceUri);
			}
		}
		return uris;
	}

	dispose(): void { }
}

interface InputTemplate {
	readonly inputWidget: SCMInputWidget;
	inputWidgetHeight: number;
	readonly elementDisposables: DisposableStore;
	readonly templateDisposable: IDisposable;
}

class InputRenderer implements ICompressibleTreeRenderer<ISCMInput, FuzzyScore, InputTemplate> {

	static readonly DEFAULT_HEIGHT = 26;

	static readonly TEMPLATE_ID = 'input';
	get templateId(): string { return InputRenderer.TEMPLATE_ID; }

	private inputWidgets = new Map<ISCMInput, SCMInputWidget>();
	private contentHeights = new WeakMap<ISCMInput, number>();
	private editorSelections = new WeakMap<ISCMInput, Selection[]>();

	constructor(
		private outerLayout: ISCMLayout,
		private overflowWidgetsDomNode: HTMLElement,
		private updateHeight: (input: ISCMInput, height: number) => void,
		@IInstantiationService private instantiationService: IInstantiationService
	) { }

	renderTemplate(container: HTMLElement): InputTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-no-twistie');

		// Disable hover for list item
		container.parentElement!.parentElement!.classList.add('force-no-hover');

		const templateDisposable = new DisposableStore();
		const inputElement = append(container, $('.scm-input'));
		const inputWidget = this.instantiationService.createInstance(SCMInputWidget, inputElement, this.overflowWidgetsDomNode);
		templateDisposable.add(inputWidget);

		return { inputWidget, inputWidgetHeight: InputRenderer.DEFAULT_HEIGHT, elementDisposables: new DisposableStore(), templateDisposable };
	}

	renderElement(node: ITreeNode<ISCMInput, FuzzyScore>, index: number, templateData: InputTemplate): void {
		const input = node.element;
		templateData.inputWidget.input = input;

		// Remember widget
		this.inputWidgets.set(input, templateData.inputWidget);
		templateData.elementDisposables.add({
			dispose: () => this.inputWidgets.delete(input)
		});

		// Widget cursor selections
		const selections = this.editorSelections.get(input);

		if (selections) {
			templateData.inputWidget.selections = selections;
		}

		templateData.elementDisposables.add(toDisposable(() => {
			const selections = templateData.inputWidget.selections;

			if (selections) {
				this.editorSelections.set(input, selections);
			}
		}));

		// Reset widget height so it's recalculated
		templateData.inputWidgetHeight = InputRenderer.DEFAULT_HEIGHT;

		// Rerender the element whenever the editor content height changes
		const onDidChangeContentHeight = () => {
			const contentHeight = templateData.inputWidget.getContentHeight();
			this.contentHeights.set(input, contentHeight);

			if (templateData.inputWidgetHeight !== contentHeight) {
				this.updateHeight(input, contentHeight + 10);
				templateData.inputWidgetHeight = contentHeight;
				templateData.inputWidget.layout();
			}
		};

		const startListeningContentHeightChange = () => {
			templateData.elementDisposables.add(templateData.inputWidget.onDidChangeContentHeight(onDidChangeContentHeight));
			onDidChangeContentHeight();
		};

		// Setup height change listener on next tick
		disposableTimeout(startListeningContentHeightChange, 0, templateData.elementDisposables);

		// Layout the editor whenever the outer layout happens
		const layoutEditor = () => templateData.inputWidget.layout();
		templateData.elementDisposables.add(this.outerLayout.onDidChange(layoutEditor));
		layoutEditor();
	}

	renderCompressedElements(): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(group: ITreeNode<ISCMInput, FuzzyScore>, index: number, template: InputTemplate): void {
		template.elementDisposables.clear();
	}

	disposeTemplate(templateData: InputTemplate): void {
		templateData.templateDisposable.dispose();
	}

	getHeight(input: ISCMInput): number {
		return (this.contentHeights.get(input) ?? InputRenderer.DEFAULT_HEIGHT) + 10;
	}

	getRenderedInputWidget(input: ISCMInput): SCMInputWidget | undefined {
		return this.inputWidgets.get(input);
	}

	getFocusedInput(): ISCMInput | undefined {
		for (const [input, inputWidget] of this.inputWidgets) {
			if (inputWidget.hasFocus()) {
				return input;
			}
		}

		return undefined;
	}

	clearValidation(): void {
		for (const [, inputWidget] of this.inputWidgets) {
			inputWidget.clearValidation();
		}
	}
}

interface ResourceGroupTemplate {
	readonly name: HTMLElement;
	readonly count: CountBadge;
	readonly actionBar: ActionBar;
	readonly elementDisposables: DisposableStore;
	readonly disposables: IDisposable;
}

class ResourceGroupRenderer implements ICompressibleTreeRenderer<ISCMResourceGroup, FuzzyScore, ResourceGroupTemplate> {

	static readonly TEMPLATE_ID = 'resource group';
	get templateId(): string { return ResourceGroupRenderer.TEMPLATE_ID; }

	constructor(
		private actionViewItemProvider: IActionViewItemProvider,
		@ISCMViewService private scmViewService: ISCMViewService
	) { }

	renderTemplate(container: HTMLElement): ResourceGroupTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-twistie');

		const element = append(container, $('.resource-group'));
		const name = append(element, $('.name'));
		const actionsContainer = append(element, $('.actions'));
		const actionBar = new ActionBar(actionsContainer, { actionViewItemProvider: this.actionViewItemProvider });
		const countContainer = append(element, $('.count'));
		const count = new CountBadge(countContainer, {}, defaultCountBadgeStyles);
		const disposables = combinedDisposable(actionBar);

		return { name, count, actionBar, elementDisposables: new DisposableStore(), disposables };
	}

	renderElement(node: ITreeNode<ISCMResourceGroup, FuzzyScore>, index: number, template: ResourceGroupTemplate): void {
		const group = node.element;
		template.name.textContent = group.label;
		template.actionBar.clear();
		template.actionBar.context = group;
		template.count.setCount(group.resources.length);

		const menus = this.scmViewService.menus.getRepositoryMenus(group.provider);
		template.elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceGroupMenu(group), template.actionBar));
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResourceGroup>, FuzzyScore>, index: number, templateData: ResourceGroupTemplate, height: number | undefined): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(group: ITreeNode<ISCMResourceGroup, FuzzyScore>, index: number, template: ResourceGroupTemplate): void {
		template.elementDisposables.clear();
	}

	disposeTemplate(template: ResourceGroupTemplate): void {
		template.elementDisposables.dispose();
		template.disposables.dispose();
	}
}

interface ResourceTemplate {
	element: HTMLElement;
	name: HTMLElement;
	fileLabel: IResourceLabel;
	decorationIcon: HTMLElement;
	actionBar: ActionBar;
	actionBarMenu: IMenu | undefined;
	readonly actionBarMenuListener: MutableDisposable<IDisposable>;
	readonly elementDisposables: DisposableStore;
	readonly disposables: IDisposable;
}

interface RenderedResourceData {
	readonly tooltip: string;
	readonly uri: URI;
	readonly fileLabelOptions: Partial<IFileLabelOptions>;
	readonly iconResource: ISCMResource | undefined;
}

class RepositoryPaneActionRunner extends ActionRunner {

	constructor(private getSelectedResources: () => (ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>)[]) {
		super();
	}

	protected override async runAction(action: IAction, context: ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>): Promise<any> {
		if (!(action instanceof MenuItemAction)) {
			return super.runAction(action, context);
		}

		const selection = this.getSelectedResources();
		const contextIsSelected = selection.some(s => s === context);
		const actualContext = contextIsSelected ? selection : [context];
		const args = actualContext.map(e => ResourceTree.isResourceNode(e) ? ResourceTree.collect(e) : [e]).flat();
		await action.run(...args);
	}
}

class ResourceRenderer implements ICompressibleTreeRenderer<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore | LabelFuzzyScore, ResourceTemplate> {

	static readonly TEMPLATE_ID = 'resource';
	get templateId(): string { return ResourceRenderer.TEMPLATE_ID; }

	private readonly disposables = new DisposableStore();
	private renderedResources = new Map<ResourceTemplate, RenderedResourceData>();

	constructor(
		private viewMode: () => ViewMode,
		private labels: ResourceLabels,
		private actionViewItemProvider: IActionViewItemProvider,
		private actionRunner: ActionRunner,
		@ILabelService private labelService: ILabelService,
		@ISCMViewService private scmViewService: ISCMViewService,
		@IThemeService private themeService: IThemeService
	) {
		themeService.onDidColorThemeChange(this.onDidColorThemeChange, this, this.disposables);
	}

	renderTemplate(container: HTMLElement): ResourceTemplate {
		const element = append(container, $('.resource'));
		const name = append(element, $('.name'));
		const fileLabel = this.labels.create(name, { supportDescriptionHighlights: true, supportHighlights: true });
		const actionsContainer = append(fileLabel.element, $('.actions'));
		const actionBar = new ActionBar(actionsContainer, {
			actionViewItemProvider: this.actionViewItemProvider,
			actionRunner: this.actionRunner
		});

		const decorationIcon = append(element, $('.decoration-icon'));
		const actionBarMenuListener = new MutableDisposable<IDisposable>();
		const disposables = combinedDisposable(actionBar, fileLabel, actionBarMenuListener);

		return { element, name, fileLabel, decorationIcon, actionBar, actionBarMenu: undefined, actionBarMenuListener, elementDisposables: new DisposableStore(), disposables };
	}

	renderElement(node: ITreeNode<ISCMResource, FuzzyScore | LabelFuzzyScore> | ITreeNode<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate): void {
		const resourceOrFolder = node.element;
		const iconResource = ResourceTree.isResourceNode(resourceOrFolder) ? resourceOrFolder.element : resourceOrFolder;
		const uri = ResourceTree.isResourceNode(resourceOrFolder) ? resourceOrFolder.uri : resourceOrFolder.sourceUri;
		const fileKind = ResourceTree.isResourceNode(resourceOrFolder) ? FileKind.FOLDER : FileKind.FILE;
		const tooltip = !ResourceTree.isResourceNode(resourceOrFolder) && resourceOrFolder.decorations.tooltip || '';
		const hidePath = this.viewMode() === ViewMode.Tree;

		let matches: IMatch[] | undefined;
		let descriptionMatches: IMatch[] | undefined;
		let strikethrough: boolean | undefined;

		if (ResourceTree.isResourceNode(resourceOrFolder)) {
			if (resourceOrFolder.element) {
				const menus = this.scmViewService.menus.getRepositoryMenus(resourceOrFolder.element.resourceGroup.provider);
				this._renderActionBar(template, resourceOrFolder, menus.getResourceMenu(resourceOrFolder.element));

				template.element.classList.toggle('faded', resourceOrFolder.element.decorations.faded);
				strikethrough = resourceOrFolder.element.decorations.strikeThrough;
			} else {
				const menus = this.scmViewService.menus.getRepositoryMenus(resourceOrFolder.context.provider);
				this._renderActionBar(template, resourceOrFolder, menus.getResourceFolderMenu(resourceOrFolder.context));

				matches = createMatches(node.filterData as FuzzyScore | undefined);
				template.element.classList.remove('faded');
			}
		} else {
			const menus = this.scmViewService.menus.getRepositoryMenus(resourceOrFolder.resourceGroup.provider);
			this._renderActionBar(template, resourceOrFolder, menus.getResourceMenu(resourceOrFolder));

			[matches, descriptionMatches] = processResourceFilterData(uri, node.filterData);
			template.element.classList.toggle('faded', resourceOrFolder.decorations.faded);
			strikethrough = resourceOrFolder.decorations.strikeThrough;
		}

		const renderedData: RenderedResourceData = {
			tooltip, uri, fileLabelOptions: { hidePath, fileKind, matches, descriptionMatches, strikethrough }, iconResource
		};

		this.renderIcon(template, renderedData);

		this.renderedResources.set(template, renderedData);
		template.elementDisposables.add(toDisposable(() => this.renderedResources.delete(template)));

		template.element.setAttribute('data-tooltip', tooltip);
	}

	disposeElement(resource: ITreeNode<ISCMResource, FuzzyScore | LabelFuzzyScore> | ITreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate): void {
		template.elementDisposables.clear();
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResource> | ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate, height: number | undefined): void {
		const compressed = node.element as ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>;
		const folder = compressed.elements[compressed.elements.length - 1];

		const label = compressed.elements.map(e => e.name);
		const fileKind = FileKind.FOLDER;

		const matches = createMatches(node.filterData as FuzzyScore | undefined);
		template.fileLabel.setResource({ resource: folder.uri, name: label }, {
			fileDecorations: { colors: false, badges: true },
			fileKind,
			matches,
			separator: this.labelService.getSeparator(folder.uri.scheme)
		});

		const menus = this.scmViewService.menus.getRepositoryMenus(folder.context.provider);
		this._renderActionBar(template, folder, menus.getResourceFolderMenu(folder.context));

		template.name.classList.remove('strike-through');
		template.element.classList.remove('faded');
		template.decorationIcon.style.display = 'none';
		template.decorationIcon.style.backgroundImage = '';

		template.element.setAttribute('data-tooltip', '');
	}

	disposeCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResource> | ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate, height: number | undefined): void {
		template.elementDisposables.clear();
	}

	disposeTemplate(template: ResourceTemplate): void {
		template.elementDisposables.dispose();
		template.disposables.dispose();
	}

	private _renderActionBar(template: ResourceTemplate, resourceOrFolder: ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, menu: IMenu): void {
		if (!template.actionBarMenu || template.actionBarMenu !== menu) {
			template.actionBar.clear();

			template.actionBarMenu = menu;
			template.actionBarMenuListener.value = connectPrimaryMenuToInlineActionBar(menu, template.actionBar);
		}

		template.actionBar.context = resourceOrFolder;
	}

	private onDidColorThemeChange(): void {
		for (const [template, data] of this.renderedResources) {
			this.renderIcon(template, data);
		}
	}

	private renderIcon(template: ResourceTemplate, data: RenderedResourceData): void {
		const theme = this.themeService.getColorTheme();
		const icon = theme.type === ColorScheme.LIGHT ? data.iconResource?.decorations.icon : data.iconResource?.decorations.iconDark;

		template.fileLabel.setFile(data.uri, {
			...data.fileLabelOptions,
			fileDecorations: { colors: false, badges: !icon },
		});

		if (icon) {
			if (ThemeIcon.isThemeIcon(icon)) {
				template.decorationIcon.className = `decoration-icon ${ThemeIcon.asClassName(icon)}`;
				if (icon.color) {
					template.decorationIcon.style.color = theme.getColor(icon.color.id)?.toString() ?? '';
				}
				template.decorationIcon.style.display = '';
				template.decorationIcon.style.backgroundImage = '';
			} else {
				template.decorationIcon.className = 'decoration-icon';
				template.decorationIcon.style.color = '';
				template.decorationIcon.style.display = '';
				template.decorationIcon.style.backgroundImage = asCSSUrl(icon);
			}
			template.decorationIcon.title = data.tooltip;
		} else {
			template.decorationIcon.className = 'decoration-icon';
			template.decorationIcon.style.color = '';
			template.decorationIcon.style.display = 'none';
			template.decorationIcon.style.backgroundImage = '';
			template.decorationIcon.title = '';
		}
	}

	dispose(): void {
		this.disposables.dispose();
	}
}


class HistoryItemGroupActionRunner extends ActionRunner {

	protected override runAction(action: IAction, context: SCMHistoryItemGroupTreeElement): Promise<void> {
		if (!(action instanceof MenuItemAction)) {
			return super.runAction(action, context);
		}

		return action.run(context.repository.provider, context.id);
	}
}

interface HistoryItemGroupTemplate {
	readonly iconContainer: HTMLElement;
	readonly label: IconLabel;
	readonly toolBar: WorkbenchToolBar;
	readonly count: CountBadge;
	readonly elementDisposables: DisposableStore;
	readonly templateDisposables: DisposableStore;
}

class HistoryItemGroupRenderer implements ICompressibleTreeRenderer<SCMHistoryItemGroupTreeElement, void, HistoryItemGroupTemplate> {

	static readonly TEMPLATE_ID = 'history-item-group';
	get templateId(): string { return HistoryItemGroupRenderer.TEMPLATE_ID; }

	constructor(
		readonly actionRunner: ActionRunner,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@IMenuService private readonly menuService: IMenuService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) { }

	renderTemplate(container: HTMLElement) {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-twistie');

		const element = append(container, $('.history-item-group'));

		const label = new IconLabel(element, { supportIcons: true });
		const iconContainer = prepend(label.element, $('.icon-container'));

		const templateDisposables = new DisposableStore();
		const toolBar = new WorkbenchToolBar(append(element, $('.actions')), { actionRunner: this.actionRunner, menuOptions: { shouldForwardArgs: true } }, this.menuService, this.contextKeyService, this.contextMenuService, this.keybindingService, this.commandService, this.telemetryService);
		templateDisposables.add(toolBar);

		const countContainer = append(element, $('.count'));
		const count = new CountBadge(countContainer, {}, defaultCountBadgeStyles);

		return { iconContainer, label, toolBar, count, elementDisposables: new DisposableStore(), templateDisposables };
	}

	renderElement(node: ITreeNode<SCMHistoryItemGroupTreeElement>, index: number, templateData: HistoryItemGroupTemplate, height: number | undefined): void {
		const historyItemGroup = node.element;

		templateData.iconContainer.className = 'icon-container';
		if (historyItemGroup.icon && ThemeIcon.isThemeIcon(historyItemGroup.icon)) {
			templateData.iconContainer.classList.add(...ThemeIcon.asClassNameArray(historyItemGroup.icon));
		}

		templateData.label.setLabel(historyItemGroup.label, historyItemGroup.description, { title: historyItemGroup.ariaLabel });
		templateData.count.setCount(historyItemGroup.count ?? 0);

		const repositoryMenus = this.scmViewService.menus.getRepositoryMenus(historyItemGroup.repository.provider);
		const historyProviderMenu = repositoryMenus.historyProviderMenu;

		if (historyProviderMenu) {
			const menu = historyProviderMenu.getHistoryItemGroupMenu(historyItemGroup);
			const resetMenuId = historyItemGroup.direction === 'incoming' ? MenuId.SCMIncomingChanges : MenuId.SCMOutgoingChanges;

			templateData.elementDisposables.add(connectPrimaryMenu(menu, (primary, secondary) => {
				templateData.toolBar.setActions(primary, secondary, [resetMenuId]);
			}));

			templateData.toolBar.context = historyItemGroup;
		} else {
			templateData.toolBar.setActions([], []);
			templateData.toolBar.context = undefined;
		}
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<SCMHistoryItemGroupTreeElement>, void>, index: number, templateData: HistoryItemGroupTemplate, height: number | undefined): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(node: ITreeNode<SCMHistoryItemGroupTreeElement>, index: number, templateData: HistoryItemGroupTemplate, height: number | undefined): void {
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: HistoryItemGroupTemplate): void {
		templateData.elementDisposables.dispose();
		templateData.templateDisposables.dispose();
	}
}

class HistoryItemActionRunner extends ActionRunner {

	protected override async runAction(action: IAction, context: SCMHistoryItemTreeElement): Promise<any> {
		if (!(action instanceof MenuItemAction)) {
			return super.runAction(action, context);
		}

		const args: (ISCMProvider | ISCMHistoryItem)[] = [];
		args.push(context.historyItemGroup.repository.provider);

		args.push({
			id: context.id,
			parentIds: context.parentIds,
			message: context.message,
			author: context.author,
			icon: context.icon,
			timestamp: context.timestamp,
			statistics: context.statistics,
		} satisfies ISCMHistoryItem);

		await action.run(...args);
	}
}

class HistoryItemActionRunner2 extends ActionRunner {
	constructor(private readonly getSelectedHistoryItems: () => SCMHistoryItemViewModelTreeElement[]) {
		super();
	}

	protected override async runAction(action: IAction, context: SCMHistoryItemViewModelTreeElement): Promise<any> {
		if (!(action instanceof MenuItemAction)) {
			return super.runAction(action, context);
		}

		const args: (ISCMProvider | ISCMHistoryItem)[] = [];
		args.push(context.repository.provider);

		const selection = this.getSelectedHistoryItems();
		const contextIsSelected = selection.some(s => s === context);
		if (contextIsSelected && selection.length > 1) {
			args.push(...selection.map(h => (
				{
					id: h.historyItemViewModel.historyItem.id,
					parentIds: h.historyItemViewModel.historyItem.parentIds,
					message: h.historyItemViewModel.historyItem.message,
					author: h.historyItemViewModel.historyItem.author,
					icon: h.historyItemViewModel.historyItem.icon,
					timestamp: h.historyItemViewModel.historyItem.timestamp,
					statistics: h.historyItemViewModel.historyItem.statistics,
				} satisfies ISCMHistoryItem)));
		} else {
			args.push({
				id: context.historyItemViewModel.historyItem.id,
				parentIds: context.historyItemViewModel.historyItem.parentIds,
				message: context.historyItemViewModel.historyItem.message,
				author: context.historyItemViewModel.historyItem.author,
				icon: context.historyItemViewModel.historyItem.icon,
				timestamp: context.historyItemViewModel.historyItem.timestamp,
				statistics: context.historyItemViewModel.historyItem.statistics,
			} satisfies ISCMHistoryItem);
		}

		await action.run(...args);
	}
}

class HistoryItemHoverDelegate extends WorkbenchHoverDelegate {
	constructor(
		private readonly viewContainerLocation: ViewContainerLocation | null,
		private readonly sideBarPosition: Position,
		@IConfigurationService configurationService: IConfigurationService,
		@IHoverService hoverService: IHoverService

	) {
		super('element', true, () => this.getHoverOptions(), configurationService, hoverService);
	}

	private getHoverOptions(): Partial<IHoverOptions> {
		let hoverPosition: HoverPosition;
		if (this.viewContainerLocation === ViewContainerLocation.Sidebar) {
			hoverPosition = this.sideBarPosition === Position.LEFT ? HoverPosition.RIGHT : HoverPosition.LEFT;
		} else if (this.viewContainerLocation === ViewContainerLocation.AuxiliaryBar) {
			hoverPosition = this.sideBarPosition === Position.LEFT ? HoverPosition.LEFT : HoverPosition.RIGHT;
		} else {
			hoverPosition = HoverPosition.RIGHT;
		}

		return { additionalClasses: ['history-item-hover'], position: { hoverPosition, forcePosition: true } };
	}
}

interface HistoryItemTemplate {
	readonly iconContainer: HTMLElement;
	readonly label: IconLabel;
	readonly statsContainer: HTMLElement;
	readonly statsCustomHover: IManagedHover;
	readonly filesLabel: HTMLElement;
	readonly insertionsLabel: HTMLElement;
	readonly deletionsLabel: HTMLElement;
	readonly actionBar: ActionBar;
	readonly elementDisposables: DisposableStore;
	readonly disposables: IDisposable;
}

class HistoryItemRenderer implements ICompressibleTreeRenderer<SCMHistoryItemTreeElement, LabelFuzzyScore, HistoryItemTemplate> {

	static readonly TEMPLATE_ID = 'history-item';
	get templateId(): string { return HistoryItemRenderer.TEMPLATE_ID; }

	constructor(
		private actionRunner: IActionRunner,
		private actionViewItemProvider: IActionViewItemProvider,
		@IHoverService private hoverService: IHoverService,
		@ISCMViewService private scmViewService: ISCMViewService
	) { }

	renderTemplate(container: HTMLElement): HistoryItemTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-twistie');

		const element = append(container, $('.history-item'));

		const iconLabel = new IconLabel(element, { supportIcons: true, supportHighlights: true, supportDescriptionHighlights: true });
		const iconContainer = prepend(iconLabel.element, $('.icon-container'));

		const disposables = new DisposableStore();
		const actionsContainer = append(element, $('.actions'));
		const actionBar = new ActionBar(actionsContainer, { actionRunner: this.actionRunner, actionViewItemProvider: this.actionViewItemProvider });
		disposables.add(actionBar);

		const statsContainer = append(element, $('.stats-container'));
		const filesLabel = append(statsContainer, $('.files-label'));
		const insertionsLabel = append(statsContainer, $('.insertions-label'));
		const deletionsLabel = append(statsContainer, $('.deletions-label'));

		const statsCustomHover = this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), statsContainer, '');
		disposables.add(statsCustomHover);

		return { iconContainer, label: iconLabel, actionBar, statsContainer, statsCustomHover, filesLabel, insertionsLabel, deletionsLabel, elementDisposables: new DisposableStore(), disposables };
	}

	renderElement(node: ITreeNode<SCMHistoryItemTreeElement, LabelFuzzyScore>, index: number, templateData: HistoryItemTemplate, height: number | undefined): void {
		const historyItem = node.element;

		templateData.iconContainer.className = 'icon-container';
		if (historyItem.icon && ThemeIcon.isThemeIcon(historyItem.icon)) {
			templateData.iconContainer.classList.add(...ThemeIcon.asClassNameArray(historyItem.icon));
		}

		const title = this.getTooltip(historyItem);
		const [matches, descriptionMatches] = this.processMatches(historyItem, node.filterData);
		templateData.label.setLabel(historyItem.message, historyItem.author, { matches, descriptionMatches, title });

		templateData.actionBar.clear();
		templateData.actionBar.context = historyItem;

		const menus = this.scmViewService.menus.getRepositoryMenus(historyItem.historyItemGroup.repository.provider);
		if (menus.historyProviderMenu) {
			const historyItemMenu = menus.historyProviderMenu.getHistoryItemMenu(historyItem);
			templateData.elementDisposables.add(connectPrimaryMenuToInlineActionBar(historyItemMenu, templateData.actionBar));
		}

		this.renderStatistics(node, index, templateData, height);
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<SCMHistoryItemTreeElement>, LabelFuzzyScore>, index: number, templateData: HistoryItemTemplate, height: number | undefined): void {
		throw new Error('Should never happen since node is incompressible');
	}

	private getTooltip(historyItem: SCMHistoryItemTreeElement): IManagedHoverTooltipMarkdownString {
		const markdown = new MarkdownString('', { isTrusted: true, supportThemeIcons: true });

		if (historyItem.author) {
			markdown.appendMarkdown(`$(account) **${historyItem.author}**\n\n`);
		}

		if (historyItem.timestamp) {
			const dateFormatter = new Intl.DateTimeFormat(platform.language, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' });
			markdown.appendMarkdown(`$(history) ${dateFormatter.format(historyItem.timestamp)}\n\n`);
		}

		markdown.appendMarkdown(historyItem.message);

		return { markdown, markdownNotSupportedFallback: historyItem.message };
	}

	private processMatches(historyItem: SCMHistoryItemTreeElement, filterData: LabelFuzzyScore | undefined): [IMatch[] | undefined, IMatch[] | undefined] {
		if (!filterData) {
			return [undefined, undefined];
		}

		return [
			historyItem.message === filterData.label ? createMatches(filterData.score) : undefined,
			historyItem.author === filterData.label ? createMatches(filterData.score) : undefined
		];
	}

	private renderStatistics(node: ITreeNode<SCMHistoryItemTreeElement, LabelFuzzyScore>, index: number, templateData: HistoryItemTemplate, height: number | undefined): void {
		const historyItem = node.element;

		if (historyItem.statistics) {
			const statsAriaLabel: string[] = [
				historyItem.statistics.files === 1 ?
					localize('fileChanged', "{0} file changed", historyItem.statistics.files) :
					localize('filesChanged', "{0} files changed", historyItem.statistics.files),
				historyItem.statistics.insertions === 1 ? localize('insertion', "{0} insertion{1}", historyItem.statistics.insertions, '(+)') :
					historyItem.statistics.insertions > 1 ? localize('insertions', "{0} insertions{1}", historyItem.statistics.insertions, '(+)') : '',
				historyItem.statistics.deletions === 1 ? localize('deletion', "{0} deletion{1}", historyItem.statistics.deletions, '(-)') :
					historyItem.statistics.deletions > 1 ? localize('deletions', "{0} deletions{1}", historyItem.statistics.deletions, '(-)') : ''
			];

			const statsTitle = statsAriaLabel.filter(l => l !== '').join(', ');
			templateData.statsContainer.setAttribute('aria-label', statsTitle);
			templateData.statsCustomHover.update(statsTitle);

			templateData.filesLabel.textContent = historyItem.statistics.files.toString();

			templateData.insertionsLabel.textContent = historyItem.statistics.insertions > 0 ? `+${historyItem.statistics.insertions}` : '';
			templateData.insertionsLabel.classList.toggle('hidden', historyItem.statistics.insertions === 0);

			templateData.deletionsLabel.textContent = historyItem.statistics.deletions > 0 ? `-${historyItem.statistics.deletions}` : '';
			templateData.deletionsLabel.classList.toggle('hidden', historyItem.statistics.deletions === 0);
		}

		templateData.statsContainer.classList.toggle('hidden', historyItem.statistics === undefined);
	}

	disposeElement(element: ITreeNode<SCMHistoryItemTreeElement, LabelFuzzyScore>, index: number, templateData: HistoryItemTemplate, height: number | undefined): void {
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: HistoryItemTemplate): void {
		templateData.disposables.dispose();
	}
}

interface HistoryItem2Template {
	readonly element: HTMLElement;
	readonly label: IconLabel;
	readonly graphContainer: HTMLElement;
	readonly labelContainer: HTMLElement;
	readonly elementDisposables: DisposableStore;
	readonly disposables: IDisposable;
}

class HistoryItem2Renderer implements ICompressibleTreeRenderer<SCMHistoryItemViewModelTreeElement, LabelFuzzyScore, HistoryItem2Template> {

	static readonly TEMPLATE_ID = 'history-item-2';
	get templateId(): string { return HistoryItem2Renderer.TEMPLATE_ID; }

	constructor(
		private readonly hoverDelegate: IHoverDelegate,
		@IHoverService private readonly hoverService: IHoverService,
		@IThemeService private readonly themeService: IThemeService
	) { }

	renderTemplate(container: HTMLElement): HistoryItem2Template {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-no-twistie');

		const element = append(container, $('.history-item'));
		const graphContainer = append(element, $('.graph-container'));
		const iconLabel = new IconLabel(element, { supportIcons: true, supportHighlights: true, supportDescriptionHighlights: true });

		const labelContainer = append(element, $('.label-container'));
		element.appendChild(labelContainer);

		return { element, graphContainer, label: iconLabel, labelContainer, elementDisposables: new DisposableStore(), disposables: new DisposableStore() };
	}

	renderElement(node: ITreeNode<SCMHistoryItemViewModelTreeElement, LabelFuzzyScore>, index: number, templateData: HistoryItem2Template, height: number | undefined): void {
		const historyItemViewModel = node.element.historyItemViewModel;
		const historyItem = historyItemViewModel.historyItem;

		const historyItemHover = this.hoverService.setupManagedHover(this.hoverDelegate, templateData.element, this.getTooltip(node.element));
		templateData.elementDisposables.add(historyItemHover);

		templateData.graphContainer.textContent = '';
		templateData.graphContainer.appendChild(renderSCMHistoryItemGraph(historyItemViewModel));

		const [matches, descriptionMatches] = this.processMatches(historyItemViewModel, node.filterData);
		templateData.label.setLabel(historyItem.message, historyItem.author, { matches, descriptionMatches });

		templateData.labelContainer.textContent = '';
		if (historyItem.labels) {
			const instantHoverDelegate = createInstantHoverDelegate();
			templateData.elementDisposables.add(instantHoverDelegate);

			for (const label of historyItem.labels) {
				if (label.icon && ThemeIcon.isThemeIcon(label.icon)) {
					const icon = append(templateData.labelContainer, $('div.label'));
					icon.classList.add(...ThemeIcon.asClassNameArray(label.icon));

					const hover = this.hoverService.setupManagedHover(instantHoverDelegate, icon, label.title);
					templateData.elementDisposables.add(hover);
				}
			}
		}
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<SCMHistoryItemViewModelTreeElement>, LabelFuzzyScore>, index: number, templateData: HistoryItem2Template, height: number | undefined): void {
		throw new Error('Should never happen since node is incompressible');
	}

	private getTooltip(element: SCMHistoryItemViewModelTreeElement): IManagedHoverTooltipMarkdownString {
		const colorTheme = this.themeService.getColorTheme();
		const historyItem = element.historyItemViewModel.historyItem;
		const currentHistoryItemGroup = element.repository.provider.historyProvider.get()?.currentHistoryItemGroup?.get();

		const markdown = new MarkdownString('', { isTrusted: true, supportThemeIcons: true });

		if (historyItem.author) {
			markdown.appendMarkdown(`$(account) **${historyItem.author}**`);

			if (historyItem.timestamp) {
				const dateFormatter = new Intl.DateTimeFormat(platform.language, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' });
				markdown.appendMarkdown(`, $(history) ${fromNow(historyItem.timestamp, true, true)} (${dateFormatter.format(historyItem.timestamp)})`);
			}

			markdown.appendMarkdown('\n\n');
		}

		markdown.appendMarkdown(`${historyItem.message}\n\n`);

		if (historyItem.statistics) {
			markdown.appendMarkdown(`---\n\n`);

			markdown.appendMarkdown(`<span>${historyItem.statistics.files === 1 ?
				localize('fileChanged', "{0} file changed", historyItem.statistics.files) :
				localize('filesChanged', "{0} files changed", historyItem.statistics.files)}</span>`);

			if (historyItem.statistics.insertions) {
				const historyItemAdditionsForegroundColor = colorTheme.getColor(historyItemAdditionsForeground);
				markdown.appendMarkdown(`,&nbsp;<span style="color:${historyItemAdditionsForegroundColor};">${historyItem.statistics.insertions === 1 ?
					localize('insertion', "{0} insertion{1}", historyItem.statistics.insertions, '(+)') :
					localize('insertions', "{0} insertions{1}", historyItem.statistics.insertions, '(+)')}</span>`);
			}

			if (historyItem.statistics.deletions) {
				const historyItemDeletionsForegroundColor = colorTheme.getColor(historyItemDeletionsForeground);
				markdown.appendMarkdown(`,&nbsp;<span style="color:${historyItemDeletionsForegroundColor};">${historyItem.statistics.deletions === 1 ?
					localize('deletion', "{0} deletion{1}", historyItem.statistics.deletions, '(-)') :
					localize('deletions', "{0} deletions{1}", historyItem.statistics.deletions, '(-)')}</span>`);
			}
		}

		if (historyItem.labels) {
			const historyItemGroupLocalColor = colorTheme.getColor(historyItemGroupLocal);
			const historyItemGroupRemoteColor = colorTheme.getColor(historyItemGroupRemote);
			const historyItemGroupBaseColor = colorTheme.getColor(historyItemGroupBase);

			const historyItemGroupHoverLabelForegroundColor = colorTheme.getColor(historyItemGroupHoverLabelForeground);

			markdown.appendMarkdown(`\n\n---\n\n`);
			markdown.appendMarkdown(historyItem.labels.map(label => {
				const historyItemGroupHoverLabelBackgroundColor =
					label.title === currentHistoryItemGroup?.name ? historyItemGroupLocalColor :
						label.title === currentHistoryItemGroup?.remote?.name ? historyItemGroupRemoteColor :
							label.title === currentHistoryItemGroup?.base?.name ? historyItemGroupBaseColor :
								undefined;

				const historyItemGroupHoverLabelIconId = ThemeIcon.isThemeIcon(label.icon) ? label.icon.id : '';

				return `<span style="color:${historyItemGroupHoverLabelForegroundColor};background-color:${historyItemGroupHoverLabelBackgroundColor};border-radius:2px;">&nbsp;$(${historyItemGroupHoverLabelIconId})&nbsp;${label.title}&nbsp;</span>`;
			}).join('&nbsp;&nbsp;'));
		}

		return { markdown, markdownNotSupportedFallback: historyItem.message };
	}

	private processMatches(historyItemViewModel: ISCMHistoryItemViewModel, filterData: LabelFuzzyScore | undefined): [IMatch[] | undefined, IMatch[] | undefined] {
		if (!filterData) {
			return [undefined, undefined];
		}

		return [
			historyItemViewModel.historyItem.message === filterData.label ? createMatches(filterData.score) : undefined,
			historyItemViewModel.historyItem.author === filterData.label ? createMatches(filterData.score) : undefined
		];
	}

	disposeElement(element: ITreeNode<SCMHistoryItemViewModelTreeElement, LabelFuzzyScore>, index: number, templateData: HistoryItem2Template, height: number | undefined): void {
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: HistoryItem2Template): void {
		templateData.disposables.dispose();
	}
}

interface HistoryItemChangeTemplate {
	readonly element: HTMLElement;
	readonly name: HTMLElement;
	readonly fileLabel: IResourceLabel;
	readonly decorationIcon: HTMLElement;
	readonly disposables: IDisposable;
}

class HistoryItemChangeRenderer implements ICompressibleTreeRenderer<SCMHistoryItemChangeTreeElement | IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>, FuzzyScore | LabelFuzzyScore, HistoryItemChangeTemplate> {

	static readonly TEMPLATE_ID = 'historyItemChange';
	get templateId(): string { return HistoryItemChangeRenderer.TEMPLATE_ID; }

	constructor(
		private readonly viewMode: () => ViewMode,
		private readonly labels: ResourceLabels,
		@ILabelService private labelService: ILabelService) { }

	renderTemplate(container: HTMLElement): HistoryItemChangeTemplate {
		const element = append(container, $('.change'));
		const name = append(element, $('.name'));
		const fileLabel = this.labels.create(name, { supportDescriptionHighlights: true, supportHighlights: true });
		const decorationIcon = append(element, $('.decoration-icon'));

		return { element, name, fileLabel, decorationIcon, disposables: new DisposableStore() };
	}

	renderElement(node: ITreeNode<SCMHistoryItemChangeTreeElement | IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>, FuzzyScore | LabelFuzzyScore>, index: number, templateData: HistoryItemChangeTemplate, height: number | undefined): void {
		const historyItemChangeOrFolder = node.element;
		const uri = ResourceTree.isResourceNode(historyItemChangeOrFolder) ? historyItemChangeOrFolder.element?.uri ?? historyItemChangeOrFolder.uri : historyItemChangeOrFolder.uri;
		const fileKind = ResourceTree.isResourceNode(historyItemChangeOrFolder) ? FileKind.FOLDER : FileKind.FILE;
		const hidePath = this.viewMode() === ViewMode.Tree;

		let matches: IMatch[] | undefined;
		let descriptionMatches: IMatch[] | undefined;

		if (ResourceTree.isResourceNode(historyItemChangeOrFolder)) {
			if (!historyItemChangeOrFolder.element) {
				matches = createMatches(node.filterData as FuzzyScore | undefined);
			}
		} else {
			[matches, descriptionMatches] = processResourceFilterData(uri, node.filterData);
		}

		templateData.fileLabel.setFile(uri, { fileDecorations: { colors: false, badges: true }, fileKind, hidePath, matches, descriptionMatches });
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<SCMHistoryItemChangeTreeElement | IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>>, FuzzyScore | LabelFuzzyScore>, index: number, templateData: HistoryItemChangeTemplate, height: number | undefined): void {
		const compressed = node.element as ICompressedTreeNode<IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>>;

		const folder = compressed.elements[compressed.elements.length - 1];
		const label = compressed.elements.map(e => e.name);
		const matches = createMatches(node.filterData as FuzzyScore | undefined);

		templateData.fileLabel.setResource({ resource: folder.uri, name: label }, {
			fileDecorations: { colors: false, badges: true },
			fileKind: FileKind.FOLDER,
			matches,
			separator: this.labelService.getSeparator(folder.uri.scheme)
		});
	}

	disposeTemplate(templateData: HistoryItemChangeTemplate): void {
		templateData.disposables.dispose();
	}
}

interface SeparatorTemplate {
	readonly label: IconLabel;
	readonly toolBar: WorkbenchToolBar;
	readonly elementDisposables: DisposableStore;
	readonly templateDisposables: DisposableStore;
}

class SeparatorRenderer implements ICompressibleTreeRenderer<SCMViewSeparatorElement, void, SeparatorTemplate> {

	static readonly TEMPLATE_ID = 'separator';
	get templateId(): string { return SeparatorRenderer.TEMPLATE_ID; }

	constructor(
		private readonly getFilterActions: (repository: ISCMRepository) => IAction[],
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@IMenuService private readonly menuService: IMenuService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) { }

	renderTemplate(container: HTMLElement): SeparatorTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-no-twistie');

		// Use default cursor & disable hover for list item
		container.parentElement!.parentElement!.classList.add('cursor-default', 'force-no-hover');

		const templateDisposables = new DisposableStore();
		const element = append(container, $('.separator-container'));
		const label = new IconLabel(element, { supportIcons: true, });
		append(element, $('.separator'));
		templateDisposables.add(label);

		const toolBar = new WorkbenchToolBar(append(element, $('.actions')), undefined, this.menuService, this.contextKeyService, this.contextMenuService, this.keybindingService, this.commandService, this.telemetryService);
		templateDisposables.add(toolBar);

		return { label, toolBar, elementDisposables: new DisposableStore(), templateDisposables };
	}
	renderElement(element: ITreeNode<SCMViewSeparatorElement, void>, index: number, templateData: SeparatorTemplate, height: number | undefined): void {
		const provider = element.element.repository.provider;
		const historyProvider = provider.historyProvider.get();
		const currentHistoryItemGroup = historyProvider?.currentHistoryItemGroup.get();

		// Label
		templateData.label.setLabel(element.element.label, undefined, { title: element.element.ariaLabel });

		// Toolbar
		const contextKeyService = this.contextKeyService.createOverlay([
			['scmHistoryItemGroupHasRemote', !!currentHistoryItemGroup?.remote],
		]);
		const menu = this.menuService.createMenu(MenuId.SCMChangesSeparator, contextKeyService);
		templateData.elementDisposables.add(connectPrimaryMenu(menu, (primary, secondary) => {
			secondary.push(...this.getFilterActions(element.element.repository));
			templateData.toolBar.setActions(primary, secondary, [MenuId.SCMChangesSeparator]);
		}));
		templateData.toolBar.context = provider;
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<SCMViewSeparatorElement>, void>, index: number, templateData: SeparatorTemplate, height: number | undefined): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(node: ITreeNode<SCMViewSeparatorElement>, index: number, templateData: SeparatorTemplate, height: number | undefined): void {
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: SeparatorTemplate): void {
		templateData.elementDisposables.dispose();
		templateData.templateDisposables.dispose();
	}
}

class ListDelegate implements IListVirtualDelegate<TreeElement> {

	constructor(private readonly inputRenderer: InputRenderer) { }

	getHeight(element: TreeElement) {
		if (isSCMInput(element)) {
			return this.inputRenderer.getHeight(element);
		} else if (isSCMActionButton(element)) {
			return ActionButtonRenderer.DEFAULT_HEIGHT + 10;
		} else {
			return 22;
		}
	}

	getTemplateId(element: TreeElement) {
		if (isSCMRepository(element)) {
			return RepositoryRenderer.TEMPLATE_ID;
		} else if (isSCMInput(element)) {
			return InputRenderer.TEMPLATE_ID;
		} else if (isSCMActionButton(element)) {
			return ActionButtonRenderer.TEMPLATE_ID;
		} else if (isSCMResourceGroup(element)) {
			return ResourceGroupRenderer.TEMPLATE_ID;
		} else if (isSCMResource(element) || isSCMResourceNode(element)) {
			return ResourceRenderer.TEMPLATE_ID;
		} else if (isSCMHistoryItemGroupTreeElement(element)) {
			return HistoryItemGroupRenderer.TEMPLATE_ID;
		} else if (isSCMHistoryItemTreeElement(element)) {
			return HistoryItemRenderer.TEMPLATE_ID;
		} else if (isSCMHistoryItemViewModelTreeElement(element)) {
			return HistoryItem2Renderer.TEMPLATE_ID;
		} else if (isSCMHistoryItemChangeTreeElement(element) || isSCMHistoryItemChangeNode(element)) {
			return HistoryItemChangeRenderer.TEMPLATE_ID;
		} else if (isSCMViewSeparator(element)) {
			return SeparatorRenderer.TEMPLATE_ID;
		} else {
			throw new Error('Unknown element');
		}
	}
}

class SCMTreeCompressionDelegate implements ITreeCompressionDelegate<TreeElement> {

	isIncompressible(element: TreeElement): boolean {
		if (ResourceTree.isResourceNode(element)) {
			return element.childrenCount === 0 || !element.parent || !element.parent.parent;
		}

		return true;
	}

}

class SCMTreeFilter implements ITreeFilter<TreeElement> {

	filter(element: TreeElement): boolean {
		if (isSCMResourceGroup(element)) {
			return element.resources.length > 0 || !element.hideWhenEmpty;
		} else {
			return true;
		}
	}
}

export class SCMTreeSorter implements ITreeSorter<TreeElement> {

	constructor(
		private readonly viewMode: () => ViewMode,
		private readonly viewSortKey: () => ViewSortKey) { }

	compare(one: TreeElement, other: TreeElement): number {
		if (isSCMRepository(one)) {
			if (!isSCMRepository(other)) {
				throw new Error('Invalid comparison');
			}

			return 0;
		}

		if (isSCMInput(one)) {
			return -1;
		} else if (isSCMInput(other)) {
			return 1;
		}

		if (isSCMActionButton(one)) {
			return -1;
		} else if (isSCMActionButton(other)) {
			return 1;
		}

		if (isSCMResourceGroup(one)) {
			return isSCMResourceGroup(other) ? 0 : -1;
		}

		if (isSCMViewSeparator(one)) {
			return isSCMResourceGroup(other) ? 1 : -1;
		}

		if (isSCMHistoryItemGroupTreeElement(one)) {
			return isSCMHistoryItemGroupTreeElement(other) ? 0 : 1;
		}

		if (isSCMHistoryItemTreeElement(one)) {
			if (!isSCMHistoryItemTreeElement(other)) {
				throw new Error('Invalid comparison');
			}

			return 0;
		}

		if (isSCMHistoryItemViewModelTreeElement(one)) {
			return isSCMHistoryItemViewModelTreeElement(other) ? 0 : 1;
		}

		if (isSCMHistoryItemChangeTreeElement(one) || isSCMHistoryItemChangeNode(one)) {
			// List
			if (this.viewMode() === ViewMode.List) {
				if (!isSCMHistoryItemChangeTreeElement(other)) {
					throw new Error('Invalid comparison');
				}

				return comparePaths(one.uri.fsPath, other.uri.fsPath);
			}

			// Tree
			if (!isSCMHistoryItemChangeTreeElement(other) && !isSCMHistoryItemChangeNode(other)) {
				throw new Error('Invalid comparison');
			}

			const oneName = isSCMHistoryItemChangeNode(one) ? one.name : basename(one.uri);
			const otherName = isSCMHistoryItemChangeNode(other) ? other.name : basename(other.uri);

			return compareFileNames(oneName, otherName);
		}

		// Resource (List)
		if (this.viewMode() === ViewMode.List) {
			// FileName
			if (this.viewSortKey() === ViewSortKey.Name) {
				const oneName = basename((one as ISCMResource).sourceUri);
				const otherName = basename((other as ISCMResource).sourceUri);

				return compareFileNames(oneName, otherName);
			}

			// Status
			if (this.viewSortKey() === ViewSortKey.Status) {
				const oneTooltip = (one as ISCMResource).decorations.tooltip ?? '';
				const otherTooltip = (other as ISCMResource).decorations.tooltip ?? '';

				if (oneTooltip !== otherTooltip) {
					return compare(oneTooltip, otherTooltip);
				}
			}

			// Path (default)
			const onePath = (one as ISCMResource).sourceUri.fsPath;
			const otherPath = (other as ISCMResource).sourceUri.fsPath;

			return comparePaths(onePath, otherPath);
		}

		// Resource (Tree)
		const oneIsDirectory = ResourceTree.isResourceNode(one);
		const otherIsDirectory = ResourceTree.isResourceNode(other);

		if (oneIsDirectory !== otherIsDirectory) {
			return oneIsDirectory ? -1 : 1;
		}

		const oneName = ResourceTree.isResourceNode(one) ? one.name : basename((one as ISCMResource).sourceUri);
		const otherName = ResourceTree.isResourceNode(other) ? other.name : basename((other as ISCMResource).sourceUri);

		return compareFileNames(oneName, otherName);
	}
}

export class SCMTreeKeyboardNavigationLabelProvider implements ICompressibleKeyboardNavigationLabelProvider<TreeElement> {

	constructor(
		private viewMode: () => ViewMode,
		@ILabelService private readonly labelService: ILabelService,
	) { }

	getKeyboardNavigationLabel(element: TreeElement): { toString(): string } | { toString(): string }[] | undefined {
		if (ResourceTree.isResourceNode(element)) {
			return element.name;
		} else if (isSCMRepository(element) || isSCMInput(element) || isSCMActionButton(element)) {
			return undefined;
		} else if (isSCMResourceGroup(element)) {
			return element.label;
		} else if (isSCMHistoryItemGroupTreeElement(element)) {
			return element.label;
		} else if (isSCMHistoryItemTreeElement(element)) {
			// For a history item we want to match both the message and
			// the author. A match in the message takes precedence over
			// a match in the author.
			return [element.message, element.author];
		} else if (isSCMHistoryItemViewModelTreeElement(element)) {
			// For a history item we want to match both the message and
			// the author. A match in the message takes precedence over
			// a match in the author.
			return [element.historyItemViewModel.historyItem.message, element.historyItemViewModel.historyItem.author];
		} else if (isSCMViewSeparator(element)) {
			return element.label;
		} else {
			if (this.viewMode() === ViewMode.List) {
				// In List mode match using the file name and the path.
				// Since we want to match both on the file name and the
				// full path we return an array of labels. A match in the
				// file name takes precedence over a match in the path.
				const uri = isSCMResource(element) ? element.sourceUri : element.uri;
				return [basename(uri), this.labelService.getUriLabel(uri, { relative: true })];
			} else {
				// In Tree mode only match using the file name
				return basename(isSCMResource(element) ? element.sourceUri : element.uri);
			}
		}
	}

	getCompressedNodeKeyboardNavigationLabel(elements: TreeElement[]): { toString(): string | undefined } | undefined {
		const folders = elements as IResourceNode<ISCMResource, ISCMResourceGroup>[];
		return folders.map(e => e.name).join('/');
	}
}

function getSCMResourceId(element: TreeElement): string {
	if (isSCMRepository(element)) {
		const provider = element.provider;
		return `repo:${provider.id}`;
	} else if (isSCMInput(element)) {
		const provider = element.repository.provider;
		return `input:${provider.id}`;
	} else if (isSCMActionButton(element)) {
		const provider = element.repository.provider;
		return `actionButton:${provider.id}`;
	} else if (isSCMResourceGroup(element)) {
		const provider = element.provider;
		return `resourceGroup:${provider.id}/${element.id}`;
	} else if (isSCMResource(element)) {
		const group = element.resourceGroup;
		const provider = group.provider;
		return `resource:${provider.id}/${group.id}/${element.sourceUri.toString()}`;
	} else if (isSCMResourceNode(element)) {
		const group = element.context;
		return `folder:${group.provider.id}/${group.id}/$FOLDER/${element.uri.toString()}`;
	} else if (isSCMHistoryItemGroupTreeElement(element)) {
		const provider = element.repository.provider;
		return `historyItemGroup:${provider.id}/${element.id}`;
	} else if (isSCMHistoryItemTreeElement(element)) {
		const historyItemGroup = element.historyItemGroup;
		const provider = historyItemGroup.repository.provider;
		return `historyItem:${provider.id}/${historyItemGroup.id}/${element.id}/${element.parentIds.join(',')}`;
	} else if (isSCMHistoryItemViewModelTreeElement(element)) {
		const provider = element.repository.provider;
		const historyItem = element.historyItemViewModel.historyItem;
		return `historyItem2:${provider.id}/${historyItem.id}/${historyItem.parentIds.join(',')}`;
	} else if (isSCMHistoryItemChangeTreeElement(element)) {
		const historyItem = element.historyItem;
		const historyItemGroup = historyItem.historyItemGroup;
		const provider = historyItemGroup.repository.provider;
		return `historyItemChange:${provider.id}/${historyItemGroup.id}/${historyItem.id}/${element.uri.toString()}`;
	} else if (isSCMHistoryItemChangeNode(element)) {
		const historyItem = element.context;
		const historyItemGroup = historyItem.historyItemGroup;
		const provider = historyItemGroup.repository.provider;
		return `folder:${provider.id}/${historyItemGroup.id}/${historyItem.id}/$FOLDER/${element.uri.toString()}`;
	} else if (isSCMViewSeparator(element)) {
		const provider = element.repository.provider;
		return `separator:${provider.id}`;
	} else {
		throw new Error('Invalid tree element');
	}
}

class SCMResourceIdentityProvider implements IIdentityProvider<TreeElement> {

	getId(element: TreeElement): string {
		return getSCMResourceId(element);
	}
}

export class SCMAccessibilityProvider implements IListAccessibilityProvider<TreeElement> {

	constructor(
		@ILabelService private readonly labelService: ILabelService
	) { }

	getWidgetAriaLabel(): string {
		return localize('scm', "Source Control Management");
	}

	getAriaLabel(element: TreeElement): string {
		if (ResourceTree.isResourceNode(element)) {
			return this.labelService.getUriLabel(element.uri, { relative: true, noPrefix: true }) || element.name;
		} else if (isSCMRepository(element)) {
			return `${element.provider.name} ${element.provider.label}`;
		} else if (isSCMInput(element)) {
			return localize('input', "Source Control Input");
		} else if (isSCMActionButton(element)) {
			return element.button?.command.title ?? '';
		} else if (isSCMResourceGroup(element)) {
			return element.label;
		} else if (isSCMHistoryItemGroupTreeElement(element)) {
			return element.ariaLabel ?? `${element.label.trim()}${element.description ? `, ${element.description}` : ''}`;
		} else if (isSCMHistoryItemTreeElement(element)) {
			return `${stripIcons(element.message).trim()}${element.author ? `, ${element.author}` : ''}`;
		} else if (isSCMHistoryItemViewModelTreeElement(element)) {
			const historyItem = element.historyItemViewModel.historyItem;
			return `${stripIcons(historyItem.message).trim()}${historyItem.author ? `, ${historyItem.author}` : ''}`;
		} else if (isSCMHistoryItemChangeTreeElement(element)) {
			const result = [basename(element.uri)];
			const path = this.labelService.getUriLabel(dirname(element.uri), { relative: true, noPrefix: true });

			if (path) {
				result.push(path);
			}

			return result.join(', ');
		} else if (isSCMViewSeparator(element)) {
			return element.ariaLabel ?? element.label;
		} else {
			const result: string[] = [];

			result.push(basename(element.sourceUri));

			if (element.decorations.tooltip) {
				result.push(element.decorations.tooltip);
			}

			const path = this.labelService.getUriLabel(dirname(element.sourceUri), { relative: true, noPrefix: true });

			if (path) {
				result.push(path);
			}

			return result.join(', ');
		}
	}
}

const enum ViewMode {
	List = 'list',
	Tree = 'tree'
}

const enum ViewSortKey {
	Path = 'path',
	Name = 'name',
	Status = 'status'
}

const Menus = {
	ViewSort: new MenuId('SCMViewSort'),
	Repositories: new MenuId('SCMRepositories'),
	ChangesSettings: new MenuId('SCMChangesSettings'),
};

export const ContextKeys = {
	SCMViewMode: new RawContextKey<ViewMode>('scmViewMode', ViewMode.List),
	SCMViewSortKey: new RawContextKey<ViewSortKey>('scmViewSortKey', ViewSortKey.Path),
	SCMViewAreAllRepositoriesCollapsed: new RawContextKey<boolean>('scmViewAreAllRepositoriesCollapsed', false),
	SCMViewIsAnyRepositoryCollapsible: new RawContextKey<boolean>('scmViewIsAnyRepositoryCollapsible', false),
	SCMProvider: new RawContextKey<string | undefined>('scmProvider', undefined),
	SCMProviderRootUri: new RawContextKey<string | undefined>('scmProviderRootUri', undefined),
	SCMProviderHasRootUri: new RawContextKey<boolean>('scmProviderHasRootUri', undefined),
	RepositoryCount: new RawContextKey<number>('scmRepositoryCount', 0),
	RepositoryVisibilityCount: new RawContextKey<number>('scmRepositoryVisibleCount', 0),
	RepositoryVisibility(repository: ISCMRepository) {
		return new RawContextKey<boolean>(`scmRepositoryVisible:${repository.provider.id}`, false);
	}
};

MenuRegistry.appendMenuItem(MenuId.SCMTitle, {
	title: localize('sortAction', "View & Sort"),
	submenu: Menus.ViewSort,
	when: ContextKeyExpr.and(ContextKeyExpr.equals('view', VIEW_PANE_ID), ContextKeys.RepositoryCount.notEqualsTo(0)),
	group: '0_view&sort',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.SCMTitle, {
	title: localize('scmChanges', "Incoming & Outgoing"),
	submenu: Menus.ChangesSettings,
	when: ContextKeyExpr.and(ContextKeyExpr.equals('view', VIEW_PANE_ID), ContextKeys.RepositoryCount.notEqualsTo(0), ContextKeyExpr.equals('config.scm.showHistoryGraph', true).negate()),
	group: '0_view&sort',
	order: 2
});

MenuRegistry.appendMenuItem(Menus.ViewSort, {
	title: localize('repositories', "Repositories"),
	submenu: Menus.Repositories,
	when: ContextKeyExpr.greater(ContextKeys.RepositoryCount.key, 1),
	group: '0_repositories'
});

abstract class SCMChangesSettingAction extends Action2 {
	constructor(
		private readonly settingKey: string,
		private readonly settingValue: 'always' | 'auto' | 'never',
		desc: Readonly<IAction2Options>) {
		super({
			...desc,
			f1: false,
			toggled: ContextKeyExpr.equals(`config.${settingKey}`, settingValue),
		});
	}

	override run(accessor: ServicesAccessor): void {
		const configurationService = accessor.get(IConfigurationService);
		configurationService.updateValue(this.settingKey, this.settingValue);
	}
}

MenuRegistry.appendMenuItem(MenuId.SCMChangesSeparator, {
	title: localize('incomingChanges', "Show Incoming Changes"),
	submenu: MenuId.SCMIncomingChangesSetting,
	group: '1_incoming&outgoing',
	order: 1,
	when: ContextKeyExpr.equals('config.scm.showHistoryGraph', false)
});

MenuRegistry.appendMenuItem(Menus.ChangesSettings, {
	title: localize('incomingChanges', "Show Incoming Changes"),
	submenu: MenuId.SCMIncomingChangesSetting,
	group: '1_incoming&outgoing',
	order: 1,
	when: ContextKeyExpr.equals('config.scm.showHistoryGraph', false)
});

registerAction2(class extends SCMChangesSettingAction {
	constructor() {
		super('scm.showIncomingChanges', 'always',
			{
				id: 'workbench.scm.action.showIncomingChanges.always',
				title: localize('always', "Always"),
				menu: { id: MenuId.SCMIncomingChangesSetting },
			});
	}
});

registerAction2(class extends SCMChangesSettingAction {
	constructor() {
		super('scm.showIncomingChanges', 'auto',
			{
				id: 'workbench.scm.action.showIncomingChanges.auto',
				title: localize('auto', "Auto"),
				menu: {
					id: MenuId.SCMIncomingChangesSetting,
				}
			});
	}
});

registerAction2(class extends SCMChangesSettingAction {
	constructor() {
		super('scm.showIncomingChanges', 'never',
			{
				id: 'workbench.scm.action.showIncomingChanges.never',
				title: localize('never', "Never"),
				menu: {
					id: MenuId.SCMIncomingChangesSetting,
				}
			});
	}
});

MenuRegistry.appendMenuItem(MenuId.SCMChangesSeparator, {
	title: localize('outgoingChanges', "Show Outgoing Changes"),
	submenu: MenuId.SCMOutgoingChangesSetting,
	group: '1_incoming&outgoing',
	order: 2,
	when: ContextKeyExpr.equals('config.scm.showHistoryGraph', false)
});

MenuRegistry.appendMenuItem(Menus.ChangesSettings, {
	title: localize('outgoingChanges', "Show Outgoing Changes"),
	submenu: MenuId.SCMOutgoingChangesSetting,
	group: '1_incoming&outgoing',
	order: 2,
	when: ContextKeyExpr.equals('config.scm.showHistoryGraph', false)
});

registerAction2(class extends SCMChangesSettingAction {
	constructor() {
		super('scm.showOutgoingChanges', 'always',
			{
				id: 'workbench.scm.action.showOutgoingChanges.always',
				title: localize('always', "Always"),
				menu: {
					id: MenuId.SCMOutgoingChangesSetting,

				}
			});
	}
});

registerAction2(class extends SCMChangesSettingAction {
	constructor() {
		super('scm.showOutgoingChanges', 'auto',
			{
				id: 'workbench.scm.action.showOutgoingChanges.auto',
				title: localize('auto', "Auto"),
				menu: {
					id: MenuId.SCMOutgoingChangesSetting,
				}
			});
	}
});

registerAction2(class extends SCMChangesSettingAction {
	constructor() {
		super('scm.showOutgoingChanges', 'never',
			{
				id: 'workbench.scm.action.showOutgoingChanges.never',
				title: localize('never', "Never"),
				menu: {
					id: MenuId.SCMOutgoingChangesSetting,
				}
			});
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.scm.action.scm.showChangesSummary',
			title: localize('showChangesSummary', "Show Changes Summary"),
			f1: false,
			toggled: ContextKeyExpr.equals('config.scm.showChangesSummary', true),
			menu: [
				{
					id: MenuId.SCMChangesSeparator,
					order: 3,
					when: ContextKeyExpr.equals('config.scm.showHistoryGraph', false)
				},
				{
					id: Menus.ChangesSettings,
					order: 3,
					when: ContextKeyExpr.equals('config.scm.showHistoryGraph', false)
				},
			]
		});
	}

	override run(accessor: ServicesAccessor) {
		const configurationService = accessor.get(IConfigurationService);
		const configValue = configurationService.getValue('scm.showChangesSummary') === true;
		configurationService.updateValue('scm.showChangesSummary', !configValue);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.scm.action.scm.viewChanges',
			title: localize('viewChanges', "View Changes"),
			f1: false,
			menu: [
				{
					id: MenuId.SCMChangesContext,
					group: '0_view',
					when: ContextKeyExpr.equals('config.multiDiffEditor.experimental.enabled', true)
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor, provider: ISCMProvider, ...historyItems: ISCMHistoryItem[]) {
		const commandService = accessor.get(ICommandService);

		if (!provider || historyItems.length === 0) {
			return;
		}

		const historyItem = historyItems[0];
		const historyItemLast = historyItems[historyItems.length - 1];
		const historyProvider = provider.historyProvider.get();

		if (historyItems.length > 1) {
			const ancestor = await historyProvider?.resolveHistoryItemGroupCommonAncestor2([historyItem.id, historyItemLast.id]);
			if (!ancestor || (ancestor !== historyItem.id && ancestor !== historyItemLast.id)) {
				return;
			}
		}

		const historyItemParentId = historyItemLast.parentIds.length > 0 ? historyItemLast.parentIds[0] : undefined;
		const historyItemChanges = await historyProvider?.provideHistoryItemChanges(historyItem.id, historyItemParentId);

		if (!historyItemChanges?.length) {
			return;
		}

		const title = historyItems.length === 1 ?
			`${historyItems[0].id.substring(0, 8)} - ${historyItems[0].message}` :
			localize('historyItemChangesEditorTitle', "All Changes ({0} ↔ {1})", historyItem.id.substring(0, 8), historyItemLast.id.substring(0, 8));

		const rootUri = provider.rootUri;
		const multiDiffSourceUri = rootUri ?
			rootUri.with({ scheme: 'scm-history-item', path: `${rootUri.path}/${historyItem.id}..${historyItemParentId}` }) :
			URI.from({ scheme: 'scm-history-item', path: `${provider.label}/${historyItem.id}..${historyItemParentId}` }, true);

		commandService.executeCommand('_workbench.openMultiDiffEditor', { title, multiDiffSourceUri, resources: historyItemChanges });
	}
});

class RepositoryVisibilityAction extends Action2 {

	private repository: ISCMRepository;

	constructor(repository: ISCMRepository) {
		super({
			id: `workbench.scm.action.toggleRepositoryVisibility.${repository.provider.id}`,
			title: repository.provider.name,
			f1: false,
			precondition: ContextKeyExpr.or(ContextKeys.RepositoryVisibilityCount.notEqualsTo(1), ContextKeys.RepositoryVisibility(repository).isEqualTo(false)),
			toggled: ContextKeys.RepositoryVisibility(repository).isEqualTo(true),
			menu: { id: Menus.Repositories, group: '0_repositories' }
		});
		this.repository = repository;
	}

	run(accessor: ServicesAccessor) {
		const scmViewService = accessor.get(ISCMViewService);
		scmViewService.toggleVisibility(this.repository);
	}
}

interface RepositoryVisibilityItem {
	readonly contextKey: IContextKey<boolean>;
	dispose(): void;
}

class RepositoryVisibilityActionController {

	private items = new Map<ISCMRepository, RepositoryVisibilityItem>();
	private repositoryCountContextKey: IContextKey<number>;
	private repositoryVisibilityCountContextKey: IContextKey<number>;
	private readonly disposables = new DisposableStore();

	constructor(
		@IContextKeyService private contextKeyService: IContextKeyService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
		@ISCMService scmService: ISCMService
	) {
		this.repositoryCountContextKey = ContextKeys.RepositoryCount.bindTo(contextKeyService);
		this.repositoryVisibilityCountContextKey = ContextKeys.RepositoryVisibilityCount.bindTo(contextKeyService);

		scmViewService.onDidChangeVisibleRepositories(this.onDidChangeVisibleRepositories, this, this.disposables);
		scmService.onDidAddRepository(this.onDidAddRepository, this, this.disposables);
		scmService.onDidRemoveRepository(this.onDidRemoveRepository, this, this.disposables);

		for (const repository of scmService.repositories) {
			this.onDidAddRepository(repository);
		}
	}

	private onDidAddRepository(repository: ISCMRepository): void {
		const action = registerAction2(class extends RepositoryVisibilityAction {
			constructor() {
				super(repository);
			}
		});

		const contextKey = ContextKeys.RepositoryVisibility(repository).bindTo(this.contextKeyService);
		contextKey.set(this.scmViewService.isVisible(repository));

		this.items.set(repository, {
			contextKey,
			dispose() {
				contextKey.reset();
				action.dispose();
			}
		});

		this.updateRepositoryContextKeys();
	}

	private onDidRemoveRepository(repository: ISCMRepository): void {
		this.items.get(repository)?.dispose();
		this.items.delete(repository);
		this.updateRepositoryContextKeys();
	}

	private onDidChangeVisibleRepositories(): void {
		let count = 0;

		for (const [repository, item] of this.items) {
			const isVisible = this.scmViewService.isVisible(repository);
			item.contextKey.set(isVisible);

			if (isVisible) {
				count++;
			}
		}

		this.repositoryCountContextKey.set(this.items.size);
		this.repositoryVisibilityCountContextKey.set(count);
	}

	private updateRepositoryContextKeys(): void {
		this.repositoryCountContextKey.set(this.items.size);
		this.repositoryVisibilityCountContextKey.set(Iterable.reduce(this.items.keys(), (r, repository) => r + (this.scmViewService.isVisible(repository) ? 1 : 0), 0));
	}

	dispose(): void {
		this.disposables.dispose();
		dispose(this.items.values());
		this.items.clear();
	}
}

class SetListViewModeAction extends ViewAction<SCMViewPane> {
	constructor(
		id = 'workbench.scm.action.setListViewMode',
		menu: Partial<IAction2Options['menu']> = {}) {
		super({
			id,
			title: localize('setListViewMode', "View as List"),
			viewId: VIEW_PANE_ID,
			f1: false,
			icon: Codicon.listTree,
			toggled: ContextKeys.SCMViewMode.isEqualTo(ViewMode.List),
			menu: { id: Menus.ViewSort, group: '1_viewmode', ...menu }
		});
	}

	async runInView(_: ServicesAccessor, view: SCMViewPane): Promise<void> {
		view.viewMode = ViewMode.List;
	}
}

class SetListViewModeNavigationAction extends SetListViewModeAction {
	constructor() {
		super(
			'workbench.scm.action.setListViewModeNavigation',
			{
				id: MenuId.SCMTitle,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', VIEW_PANE_ID), ContextKeys.RepositoryCount.notEqualsTo(0), ContextKeys.SCMViewMode.isEqualTo(ViewMode.Tree)),
				group: 'navigation',
				order: -1000
			});
	}
}

class SetTreeViewModeAction extends ViewAction<SCMViewPane> {
	constructor(
		id = 'workbench.scm.action.setTreeViewMode',
		menu: Partial<IAction2Options['menu']> = {}) {
		super(
			{
				id,
				title: localize('setTreeViewMode', "View as Tree"),
				viewId: VIEW_PANE_ID,
				f1: false,
				icon: Codicon.listFlat,
				toggled: ContextKeys.SCMViewMode.isEqualTo(ViewMode.Tree),
				menu: { id: Menus.ViewSort, group: '1_viewmode', ...menu }
			});
	}

	async runInView(_: ServicesAccessor, view: SCMViewPane): Promise<void> {
		view.viewMode = ViewMode.Tree;
	}
}

class SetTreeViewModeNavigationAction extends SetTreeViewModeAction {
	constructor() {
		super(
			'workbench.scm.action.setTreeViewModeNavigation',
			{
				id: MenuId.SCMTitle,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', VIEW_PANE_ID), ContextKeys.RepositoryCount.notEqualsTo(0), ContextKeys.SCMViewMode.isEqualTo(ViewMode.List)),
				group: 'navigation',
				order: -1000
			});
	}
}

registerAction2(SetListViewModeAction);
registerAction2(SetTreeViewModeAction);
registerAction2(SetListViewModeNavigationAction);
registerAction2(SetTreeViewModeNavigationAction);

abstract class RepositorySortAction extends ViewAction<SCMViewPane> {
	constructor(private sortKey: ISCMRepositorySortKey, title: string) {
		super({
			id: `workbench.scm.action.repositories.setSortKey.${sortKey}`,
			title,
			viewId: VIEW_PANE_ID,
			f1: false,
			toggled: RepositoryContextKeys.RepositorySortKey.isEqualTo(sortKey),
			menu: [
				{
					id: Menus.Repositories,
					group: '1_sort'
				},
				{
					id: MenuId.SCMSourceControlTitle,
					group: '1_sort',
				},
			]
		});
	}

	runInView(accessor: ServicesAccessor) {
		accessor.get(ISCMViewService).toggleSortKey(this.sortKey);
	}
}


class RepositorySortByDiscoveryTimeAction extends RepositorySortAction {
	constructor() {
		super(ISCMRepositorySortKey.DiscoveryTime, localize('repositorySortByDiscoveryTime', "Sort by Discovery Time"));
	}
}

class RepositorySortByNameAction extends RepositorySortAction {
	constructor() {
		super(ISCMRepositorySortKey.Name, localize('repositorySortByName', "Sort by Name"));
	}
}

class RepositorySortByPathAction extends RepositorySortAction {
	constructor() {
		super(ISCMRepositorySortKey.Path, localize('repositorySortByPath', "Sort by Path"));
	}
}

registerAction2(RepositorySortByDiscoveryTimeAction);
registerAction2(RepositorySortByNameAction);
registerAction2(RepositorySortByPathAction);

abstract class SetSortKeyAction extends ViewAction<SCMViewPane> {
	constructor(private sortKey: ViewSortKey, title: string) {
		super({
			id: `workbench.scm.action.setSortKey.${sortKey}`,
			title,
			viewId: VIEW_PANE_ID,
			f1: false,
			toggled: ContextKeys.SCMViewSortKey.isEqualTo(sortKey),
			precondition: ContextKeys.SCMViewMode.isEqualTo(ViewMode.List),
			menu: { id: Menus.ViewSort, group: '2_sort' }
		});
	}

	async runInView(_: ServicesAccessor, view: SCMViewPane): Promise<void> {
		view.viewSortKey = this.sortKey;
	}
}

class SetSortByNameAction extends SetSortKeyAction {
	constructor() {
		super(ViewSortKey.Name, localize('sortChangesByName', "Sort Changes by Name"));
	}
}

class SetSortByPathAction extends SetSortKeyAction {
	constructor() {
		super(ViewSortKey.Path, localize('sortChangesByPath', "Sort Changes by Path"));
	}
}

class SetSortByStatusAction extends SetSortKeyAction {
	constructor() {
		super(ViewSortKey.Status, localize('sortChangesByStatus', "Sort Changes by Status"));
	}
}

registerAction2(SetSortByNameAction);
registerAction2(SetSortByPathAction);
registerAction2(SetSortByStatusAction);

class CollapseAllRepositoriesAction extends ViewAction<SCMViewPane> {

	constructor() {
		super({
			id: `workbench.scm.action.collapseAllRepositories`,
			title: localize('collapse all', "Collapse All Repositories"),
			viewId: VIEW_PANE_ID,
			f1: false,
			icon: Codicon.collapseAll,
			menu: {
				id: MenuId.SCMTitle,
				group: 'navigation',
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', VIEW_PANE_ID), ContextKeys.SCMViewIsAnyRepositoryCollapsible.isEqualTo(true), ContextKeys.SCMViewAreAllRepositoriesCollapsed.isEqualTo(false))
			}
		});
	}

	async runInView(_: ServicesAccessor, view: SCMViewPane): Promise<void> {
		view.collapseAllRepositories();
	}
}

class ExpandAllRepositoriesAction extends ViewAction<SCMViewPane> {

	constructor() {
		super({
			id: `workbench.scm.action.expandAllRepositories`,
			title: localize('expand all', "Expand All Repositories"),
			viewId: VIEW_PANE_ID,
			f1: false,
			icon: Codicon.expandAll,
			menu: {
				id: MenuId.SCMTitle,
				group: 'navigation',
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', VIEW_PANE_ID), ContextKeys.SCMViewIsAnyRepositoryCollapsible.isEqualTo(true), ContextKeys.SCMViewAreAllRepositoriesCollapsed.isEqualTo(true))
			}
		});
	}

	async runInView(_: ServicesAccessor, view: SCMViewPane): Promise<void> {
		view.expandAllRepositories();
	}
}

registerAction2(CollapseAllRepositoriesAction);
registerAction2(ExpandAllRepositoriesAction);

const enum SCMInputWidgetCommandId {
	CancelAction = 'scm.input.cancelAction'
}

const enum SCMInputWidgetStorageKey {
	LastActionId = 'scm.input.lastActionId'
}

class SCMInputWidgetActionRunner extends ActionRunner {

	private readonly _runningActions = new Set<IAction>();
	public get runningActions(): Set<IAction> { return this._runningActions; }

	private _cts: CancellationTokenSource | undefined;

	constructor(
		private readonly input: ISCMInput,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
	}

	protected override async runAction(action: IAction): Promise<void> {
		try {
			// Cancel previous action
			if (this.runningActions.size !== 0) {
				this._cts?.cancel();

				if (action.id === SCMInputWidgetCommandId.CancelAction) {
					return;
				}
			}

			// Create action context
			const context: ISCMInputValueProviderContext[] = [];
			for (const group of this.input.repository.provider.groups) {
				context.push({
					resourceGroupId: group.id,
					resources: [...group.resources.map(r => r.sourceUri)]
				});
			}

			// Run action
			this._runningActions.add(action);
			this._cts = new CancellationTokenSource();
			await action.run(...[this.input.repository.provider.rootUri, context, this._cts.token]);
		} finally {
			this._runningActions.delete(action);

			// Save last action
			if (this._runningActions.size === 0) {
				this.storageService.store(SCMInputWidgetStorageKey.LastActionId, action.id, StorageScope.PROFILE, StorageTarget.USER);
			}
		}
	}

}

class SCMInputWidgetToolbar extends WorkbenchToolBar {

	private _dropdownActions: IAction[] = [];
	get dropdownActions(): IAction[] { return this._dropdownActions; }

	private _dropdownAction: IAction;
	get dropdownAction(): IAction { return this._dropdownAction; }

	private _cancelAction: IAction;

	private _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _disposables = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		container: HTMLElement,
		options: IMenuWorkbenchToolBarOptions | undefined,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ICommandService commandService: ICommandService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService private readonly storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(container, { resetMenu: MenuId.SCMInputBox, ...options }, menuService, contextKeyService, contextMenuService, keybindingService, commandService, telemetryService);

		this._dropdownAction = new Action(
			'scmInputMoreActions',
			localize('scmInputMoreActions', "More Actions..."),
			'codicon-chevron-down');

		this._cancelAction = new MenuItemAction({
			id: SCMInputWidgetCommandId.CancelAction,
			title: localize('scmInputCancelAction', "Cancel"),
			icon: Codicon.debugStop,
		}, undefined, undefined, undefined, undefined, contextKeyService, commandService);
	}

	public setInput(input: ISCMInput): void {
		this._disposables.value = new DisposableStore();

		const contextKeyService = this.contextKeyService.createOverlay([
			['scmProvider', input.repository.provider.contextValue],
			['scmProviderRootUri', input.repository.provider.rootUri?.toString()],
			['scmProviderHasRootUri', !!input.repository.provider.rootUri]
		]);

		const menu = this._disposables.value.add(this.menuService.createMenu(MenuId.SCMInputBox, contextKeyService, { emitEventsForSubmenuChanges: true }));

		const isEnabled = (): boolean => {
			return input.repository.provider.groups.some(g => g.resources.length > 0);
		};

		const updateToolbar = () => {
			const actions: IAction[] = [];
			createAndFillInActionBarActions(menu, { shouldForwardArgs: true }, actions);

			for (const action of actions) {
				action.enabled = isEnabled();
			}
			this._dropdownAction.enabled = isEnabled();

			let primaryAction: IAction | undefined = undefined;

			if (actions.length === 1) {
				primaryAction = actions[0];
			} else if (actions.length > 1) {
				const lastActionId = this.storageService.get(SCMInputWidgetStorageKey.LastActionId, StorageScope.PROFILE, '');
				primaryAction = actions.find(a => a.id === lastActionId) ?? actions[0];
			}

			this._dropdownActions = actions.length === 1 ? [] : actions;
			super.setActions(primaryAction ? [primaryAction] : [], []);

			this._onDidChange.fire();
		};

		this._disposables.value.add(menu.onDidChange(() => updateToolbar()));
		this._disposables.value.add(input.repository.provider.onDidChangeResources(() => updateToolbar()));
		this._disposables.value.add(this.storageService.onDidChangeValue(StorageScope.PROFILE, SCMInputWidgetStorageKey.LastActionId, this._disposables.value)(() => updateToolbar()));

		this.actionRunner = new SCMInputWidgetActionRunner(input, this.storageService);
		this._disposables.value.add(this.actionRunner.onWillRun(e => {
			if ((this.actionRunner as SCMInputWidgetActionRunner).runningActions.size === 0) {
				super.setActions([this._cancelAction], []);
				this._onDidChange.fire();
			}
		}));
		this._disposables.value.add(this.actionRunner.onDidRun(e => {
			if ((this.actionRunner as SCMInputWidgetActionRunner).runningActions.size === 0) {
				updateToolbar();
			}
		}));

		updateToolbar();
	}
}

class SCMInputWidgetEditorOptions {

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly defaultInputFontFamily = DEFAULT_FONT_FAMILY;

	private readonly _disposables = new DisposableStore();

	constructor(
		private readonly overflowWidgetsDomNode: HTMLElement,
		private readonly configurationService: IConfigurationService) {

		const onDidChangeConfiguration = Event.filter(
			this.configurationService.onDidChangeConfiguration,
			e => {
				return e.affectsConfiguration('editor.accessibilitySupport') ||
					e.affectsConfiguration('editor.cursorBlinking') ||
					e.affectsConfiguration('editor.fontFamily') ||
					e.affectsConfiguration('editor.rulers') ||
					e.affectsConfiguration('editor.wordWrap') ||
					e.affectsConfiguration('scm.inputFontFamily') ||
					e.affectsConfiguration('scm.inputFontSize');
			},
			this._disposables
		);

		this._disposables.add(onDidChangeConfiguration(() => this._onDidChange.fire()));
	}

	getEditorConstructionOptions(): IEditorConstructionOptions {
		const fontFamily = this._getEditorFontFamily();
		const fontSize = this._getEditorFontSize();
		const lineHeight = this._getEditorLineHeight(fontSize);

		return {
			...getSimpleEditorOptions(this.configurationService),
			...this._getEditorLanguageConfiguration(),
			cursorWidth: 1,
			dragAndDrop: true,
			dropIntoEditor: { enabled: true },
			fontFamily: fontFamily,
			fontSize: fontSize,
			formatOnType: true,
			lineDecorationsWidth: 6,
			lineHeight: lineHeight,
			overflowWidgetsDomNode: this.overflowWidgetsDomNode,
			padding: { top: 2, bottom: 2 },
			quickSuggestions: false,
			renderWhitespace: 'none',
			scrollbar: {
				alwaysConsumeMouseWheel: false,
				vertical: 'hidden'
			},
			wrappingIndent: 'none',
			wrappingStrategy: 'advanced',
		};
	}

	getEditorOptions(): IEditorOptions {
		const fontFamily = this._getEditorFontFamily();
		const fontSize = this._getEditorFontSize();
		const lineHeight = this._getEditorLineHeight(fontSize);
		const accessibilitySupport = this.configurationService.getValue<'auto' | 'off' | 'on'>('editor.accessibilitySupport');
		const cursorBlinking = this.configurationService.getValue<'blink' | 'smooth' | 'phase' | 'expand' | 'solid'>('editor.cursorBlinking');

		return { ...this._getEditorLanguageConfiguration(), accessibilitySupport, cursorBlinking, fontFamily, fontSize, lineHeight };
	}

	private _getEditorFontFamily(): string {
		const inputFontFamily = this.configurationService.getValue<string>('scm.inputFontFamily').trim();

		if (inputFontFamily.toLowerCase() === 'editor') {
			return this.configurationService.getValue<string>('editor.fontFamily').trim();
		}

		if (inputFontFamily.length !== 0 && inputFontFamily.toLowerCase() !== 'default') {
			return inputFontFamily;
		}

		return this.defaultInputFontFamily;
	}

	private _getEditorFontSize(): number {
		return this.configurationService.getValue<number>('scm.inputFontSize');
	}

	private _getEditorLanguageConfiguration(): IEditorOptions {
		// editor.rulers
		const rulersConfig = this.configurationService.inspect('editor.rulers', { overrideIdentifier: 'scminput' });
		const rulers = rulersConfig.overrideIdentifiers?.includes('scminput') ? EditorOptions.rulers.validate(rulersConfig.value) : [];

		// editor.wordWrap
		const wordWrapConfig = this.configurationService.inspect('editor.wordWrap', { overrideIdentifier: 'scminput' });
		const wordWrap = wordWrapConfig.overrideIdentifiers?.includes('scminput') ? EditorOptions.wordWrap.validate(wordWrapConfig.value) : 'on';

		return { rulers, wordWrap };
	}

	private _getEditorLineHeight(fontSize: number): number {
		return Math.round(fontSize * 1.5);
	}

	dispose(): void {
		this._disposables.dispose();
	}

}

class SCMInputWidget {

	private static readonly ValidationTimeouts: { [severity: number]: number } = {
		[InputValidationType.Information]: 5000,
		[InputValidationType.Warning]: 8000,
		[InputValidationType.Error]: 10000
	};

	private readonly contextKeyService: IContextKeyService;

	private element: HTMLElement;
	private editorContainer: HTMLElement;
	private readonly inputEditor: CodeEditorWidget;
	private readonly inputEditorOptions: SCMInputWidgetEditorOptions;
	private toolbarContainer: HTMLElement;
	private toolbar: SCMInputWidgetToolbar;
	private readonly disposables = new DisposableStore();

	private model: { readonly input: ISCMInput; readonly textModel: ITextModel } | undefined;
	private repositoryIdContextKey: IContextKey<string | undefined>;
	private readonly repositoryDisposables = new DisposableStore();

	private validation: IInputValidation | undefined;
	private validationContextView: IOpenContextView | undefined;
	private validationHasFocus: boolean = false;
	private _validationTimer: any;

	// This is due to "Setup height change listener on next tick" above
	// https://github.com/microsoft/vscode/issues/108067
	private lastLayoutWasTrash = false;
	private shouldFocusAfterLayout = false;

	readonly onDidChangeContentHeight: Event<void>;

	get input(): ISCMInput | undefined {
		return this.model?.input;
	}

	set input(input: ISCMInput | undefined) {
		if (input === this.input) {
			return;
		}

		this.clearValidation();
		this.element.classList.remove('synthetic-focus');

		this.repositoryDisposables.clear();
		this.repositoryIdContextKey.set(input?.repository.id);

		if (!input) {
			this.inputEditor.setModel(undefined);
			this.model = undefined;
			return;
		}

		const textModel = input.repository.provider.inputBoxTextModel;
		this.inputEditor.setModel(textModel);

		if (this.configurationService.getValue('editor.wordBasedSuggestions', { resource: textModel.uri }) !== 'off') {
			this.configurationService.updateValue('editor.wordBasedSuggestions', 'off', { resource: textModel.uri }, ConfigurationTarget.MEMORY);
		}

		// Validation
		const validationDelayer = new ThrottledDelayer<any>(200);
		const validate = async () => {
			const position = this.inputEditor.getSelection()?.getStartPosition();
			const offset = position && textModel.getOffsetAt(position);
			const value = textModel.getValue();

			this.setValidation(await input.validateInput(value, offset || 0));
		};

		const triggerValidation = () => validationDelayer.trigger(validate);
		this.repositoryDisposables.add(validationDelayer);
		this.repositoryDisposables.add(this.inputEditor.onDidChangeCursorPosition(triggerValidation));

		// Adaptive indentation rules
		const opts = this.modelService.getCreationOptions(textModel.getLanguageId(), textModel.uri, textModel.isForSimpleWidget);
		const onEnter = Event.filter(this.inputEditor.onKeyDown, e => e.keyCode === KeyCode.Enter, this.repositoryDisposables);
		this.repositoryDisposables.add(onEnter(() => textModel.detectIndentation(opts.insertSpaces, opts.tabSize)));

		// Keep model in sync with API
		textModel.setValue(input.value);
		this.repositoryDisposables.add(input.onDidChange(({ value, reason }) => {
			const currentValue = textModel.getValue();
			if (value === currentValue) { // circuit breaker
				return;
			}

			textModel.pushStackElement();
			textModel.pushEditOperations(null, [EditOperation.replaceMove(textModel.getFullModelRange(), value)], () => []);

			const position = reason === SCMInputChangeReason.HistoryPrevious
				? textModel.getFullModelRange().getStartPosition()
				: textModel.getFullModelRange().getEndPosition();
			this.inputEditor.setPosition(position);
			this.inputEditor.revealPositionInCenterIfOutsideViewport(position);
		}));
		this.repositoryDisposables.add(input.onDidChangeFocus(() => this.focus()));
		this.repositoryDisposables.add(input.onDidChangeValidationMessage((e) => this.setValidation(e, { focus: true, timeout: true })));
		this.repositoryDisposables.add(input.onDidChangeValidateInput((e) => triggerValidation()));

		// Keep API in sync with model and validate
		this.repositoryDisposables.add(textModel.onDidChangeContent(() => {
			input.setValue(textModel.getValue(), true);
			triggerValidation();
		}));

		// Update placeholder text
		const updatePlaceholderText = () => {
			const binding = this.keybindingService.lookupKeybinding('scm.acceptInput');
			const label = binding ? binding.getLabel() : (platform.isMacintosh ? 'Cmd+Enter' : 'Ctrl+Enter');
			const placeholderText = format(input.placeholder, label);

			this.inputEditor.updateOptions({ placeholder: placeholderText });
		};
		this.repositoryDisposables.add(input.onDidChangePlaceholder(updatePlaceholderText));
		this.repositoryDisposables.add(this.keybindingService.onDidUpdateKeybindings(updatePlaceholderText));
		updatePlaceholderText();

		// Update input template
		let commitTemplate = '';
		this.repositoryDisposables.add(autorun(reader => {
			if (!input.visible) {
				return;
			}

			const oldCommitTemplate = commitTemplate;
			commitTemplate = input.repository.provider.commitTemplate.read(reader);

			const value = textModel.getValue();
			if (value && value !== oldCommitTemplate) {
				return;
			}

			textModel.setValue(commitTemplate);
		}));

		// Update input enablement
		const updateEnablement = (enabled: boolean) => {
			this.inputEditor.updateOptions({ readOnly: !enabled });
		};
		this.repositoryDisposables.add(input.onDidChangeEnablement(enabled => updateEnablement(enabled)));
		updateEnablement(input.enabled);

		// Toolbar
		this.toolbar.setInput(input);

		// Save model
		this.model = { input, textModel };
	}

	get selections(): Selection[] | null {
		return this.inputEditor.getSelections();
	}

	set selections(selections: Selection[] | null) {
		if (selections) {
			this.inputEditor.setSelections(selections);
		}
	}

	private setValidation(validation: IInputValidation | undefined, options?: { focus?: boolean; timeout?: boolean }) {
		if (this._validationTimer) {
			clearTimeout(this._validationTimer);
			this._validationTimer = 0;
		}

		this.validation = validation;
		this.renderValidation();

		if (options?.focus && !this.hasFocus()) {
			this.focus();
		}

		if (validation && options?.timeout) {
			this._validationTimer = setTimeout(() => this.setValidation(undefined), SCMInputWidget.ValidationTimeouts[validation.type]);
		}
	}

	constructor(
		container: HTMLElement,
		overflowWidgetsDomNode: HTMLElement,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IModelService private modelService: IModelService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		this.element = append(container, $('.scm-editor'));
		this.editorContainer = append(this.element, $('.scm-editor-container'));
		this.toolbarContainer = append(this.element, $('.scm-editor-toolbar'));

		this.contextKeyService = contextKeyService.createScoped(this.element);
		this.repositoryIdContextKey = this.contextKeyService.createKey('scmRepository', undefined);

		this.inputEditorOptions = new SCMInputWidgetEditorOptions(overflowWidgetsDomNode, this.configurationService);
		this.disposables.add(this.inputEditorOptions.onDidChange(this.onDidChangeEditorOptions, this));
		this.disposables.add(this.inputEditorOptions);

		const codeEditorWidgetOptions: ICodeEditorWidgetOptions = {
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				CodeActionController.ID,
				ColorDetector.ID,
				ContextMenuController.ID,
				CopyPasteController.ID,
				DragAndDropController.ID,
				DropIntoEditorController.ID,
				EditorDictation.ID,
				FormatOnType.ID,
				HoverController.ID,
				InlineCompletionsController.ID,
				LinkDetector.ID,
				MenuPreventer.ID,
				MessageController.ID,
				PlaceholderTextContribution.ID,
				SelectionClipboardContributionID,
				SnippetController2.ID,
				SuggestController.ID
			]),
			isSimpleWidget: true
		};

		const services = new ServiceCollection([IContextKeyService, this.contextKeyService]);
		const instantiationService2 = instantiationService.createChild(services, this.disposables);
		const editorConstructionOptions = this.inputEditorOptions.getEditorConstructionOptions();
		this.inputEditor = instantiationService2.createInstance(CodeEditorWidget, this.editorContainer, editorConstructionOptions, codeEditorWidgetOptions);
		this.disposables.add(this.inputEditor);

		this.disposables.add(this.inputEditor.onDidFocusEditorText(() => {
			if (this.input?.repository) {
				this.scmViewService.focus(this.input.repository);
			}

			this.element.classList.add('synthetic-focus');
			this.renderValidation();
		}));
		this.disposables.add(this.inputEditor.onDidBlurEditorText(() => {
			this.element.classList.remove('synthetic-focus');

			setTimeout(() => {
				if (!this.validation || !this.validationHasFocus) {
					this.clearValidation();
				}
			}, 0);
		}));

		this.disposables.add(this.inputEditor.onDidBlurEditorWidget(() => {
			CopyPasteController.get(this.inputEditor)?.clearWidgets();
			DropIntoEditorController.get(this.inputEditor)?.clearWidgets();
		}));

		const firstLineKey = this.contextKeyService.createKey<boolean>('scmInputIsInFirstPosition', false);
		const lastLineKey = this.contextKeyService.createKey<boolean>('scmInputIsInLastPosition', false);

		this.disposables.add(this.inputEditor.onDidChangeCursorPosition(({ position }) => {
			const viewModel = this.inputEditor._getViewModel()!;
			const lastLineNumber = viewModel.getLineCount();
			const lastLineCol = viewModel.getLineLength(lastLineNumber) + 1;
			const viewPosition = viewModel.coordinatesConverter.convertModelPositionToViewPosition(position);
			firstLineKey.set(viewPosition.lineNumber === 1 && viewPosition.column === 1);
			lastLineKey.set(viewPosition.lineNumber === lastLineNumber && viewPosition.column === lastLineCol);
		}));
		this.disposables.add(this.inputEditor.onDidScrollChange(e => {
			this.toolbarContainer.classList.toggle('scroll-decoration', e.scrollTop > 0);
		}));

		Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.showInputActionButton'))(() => this.layout(), this, this.disposables);

		this.onDidChangeContentHeight = Event.signal(Event.filter(this.inputEditor.onDidContentSizeChange, e => e.contentHeightChanged, this.disposables));

		// Toolbar
		this.toolbar = instantiationService2.createInstance(SCMInputWidgetToolbar, this.toolbarContainer, {
			actionViewItemProvider: (action, options) => {
				if (action instanceof MenuItemAction && this.toolbar.dropdownActions.length > 1) {
					return instantiationService.createInstance(DropdownWithPrimaryActionViewItem, action, this.toolbar.dropdownAction, this.toolbar.dropdownActions, '', this.contextMenuService, { actionRunner: this.toolbar.actionRunner, hoverDelegate: options.hoverDelegate });
				}

				return createActionViewItem(instantiationService, action, options);
			},
			menuOptions: {
				shouldForwardArgs: true
			}
		});
		this.disposables.add(this.toolbar.onDidChange(() => this.layout()));
		this.disposables.add(this.toolbar);
	}

	getContentHeight(): number {
		const lineHeight = this.inputEditor.getOption(EditorOption.lineHeight);
		const { top, bottom } = this.inputEditor.getOption(EditorOption.padding);

		const inputMinLinesConfig = this.configurationService.getValue('scm.inputMinLineCount');
		const inputMinLines = typeof inputMinLinesConfig === 'number' ? clamp(inputMinLinesConfig, 1, 50) : 1;
		const editorMinHeight = inputMinLines * lineHeight + top + bottom;

		const inputMaxLinesConfig = this.configurationService.getValue('scm.inputMaxLineCount');
		const inputMaxLines = typeof inputMaxLinesConfig === 'number' ? clamp(inputMaxLinesConfig, 1, 50) : 10;
		const editorMaxHeight = inputMaxLines * lineHeight + top + bottom;

		return clamp(this.inputEditor.getContentHeight(), editorMinHeight, editorMaxHeight);
	}

	layout(): void {
		const editorHeight = this.getContentHeight();
		const toolbarWidth = this.getToolbarWidth();
		const dimension = new Dimension(this.element.clientWidth - toolbarWidth, editorHeight);

		if (dimension.width < 0) {
			this.lastLayoutWasTrash = true;
			return;
		}

		this.lastLayoutWasTrash = false;
		this.inputEditor.layout(dimension);
		this.renderValidation();

		const showInputActionButton = this.configurationService.getValue<boolean>('scm.showInputActionButton') === true;
		this.toolbarContainer.classList.toggle('hidden', !showInputActionButton || this.toolbar?.isEmpty() === true);

		if (this.shouldFocusAfterLayout) {
			this.shouldFocusAfterLayout = false;
			this.focus();
		}
	}

	focus(): void {
		if (this.lastLayoutWasTrash) {
			this.lastLayoutWasTrash = false;
			this.shouldFocusAfterLayout = true;
			return;
		}

		this.inputEditor.focus();
		this.element.classList.add('synthetic-focus');
	}

	hasFocus(): boolean {
		return this.inputEditor.hasTextFocus();
	}

	private onDidChangeEditorOptions(): void {
		this.inputEditor.updateOptions(this.inputEditorOptions.getEditorOptions());
	}

	private renderValidation(): void {
		this.clearValidation();

		this.element.classList.toggle('validation-info', this.validation?.type === InputValidationType.Information);
		this.element.classList.toggle('validation-warning', this.validation?.type === InputValidationType.Warning);
		this.element.classList.toggle('validation-error', this.validation?.type === InputValidationType.Error);

		if (!this.validation || !this.inputEditor.hasTextFocus()) {
			return;
		}

		const disposables = new DisposableStore();

		this.validationContextView = this.contextViewService.showContextView({
			getAnchor: () => this.element,
			render: container => {
				this.element.style.borderBottomLeftRadius = '0';
				this.element.style.borderBottomRightRadius = '0';

				const validationContainer = append(container, $('.scm-editor-validation-container'));
				validationContainer.classList.toggle('validation-info', this.validation!.type === InputValidationType.Information);
				validationContainer.classList.toggle('validation-warning', this.validation!.type === InputValidationType.Warning);
				validationContainer.classList.toggle('validation-error', this.validation!.type === InputValidationType.Error);
				validationContainer.style.width = `${this.element.clientWidth + 2}px`;
				const element = append(validationContainer, $('.scm-editor-validation'));

				const message = this.validation!.message;
				if (typeof message === 'string') {
					element.textContent = message;
				} else {
					const tracker = trackFocus(element);
					disposables.add(tracker);
					disposables.add(tracker.onDidFocus(() => (this.validationHasFocus = true)));
					disposables.add(tracker.onDidBlur(() => {
						this.validationHasFocus = false;
						this.element.style.borderBottomLeftRadius = '2px';
						this.element.style.borderBottomRightRadius = '2px';
						this.contextViewService.hideContextView();
					}));

					const renderer = disposables.add(this.instantiationService.createInstance(MarkdownRenderer, {}));
					const renderedMarkdown = renderer.render(message, {
						actionHandler: {
							callback: (link) => {
								openLinkFromMarkdown(this.openerService, link, message.isTrusted);
								this.element.style.borderBottomLeftRadius = '2px';
								this.element.style.borderBottomRightRadius = '2px';
								this.contextViewService.hideContextView();
							},
							disposables: disposables
						},
					});
					disposables.add(renderedMarkdown);
					element.appendChild(renderedMarkdown.element);
				}
				const actionsContainer = append(validationContainer, $('.scm-editor-validation-actions'));
				const actionbar = new ActionBar(actionsContainer);
				const action = new Action('scmInputWidget.validationMessage.close', localize('label.close', "Close"), ThemeIcon.asClassName(Codicon.close), true, () => {
					this.contextViewService.hideContextView();
					this.element.style.borderBottomLeftRadius = '2px';
					this.element.style.borderBottomRightRadius = '2px';
				});
				disposables.add(actionbar);
				actionbar.push(action, { icon: true, label: false });

				return Disposable.None;
			},
			onHide: () => {
				this.validationHasFocus = false;
				this.element.style.borderBottomLeftRadius = '2px';
				this.element.style.borderBottomRightRadius = '2px';
				disposables.dispose();
			},
			anchorAlignment: AnchorAlignment.LEFT
		});
	}

	private getToolbarWidth(): number {
		const showInputActionButton = this.configurationService.getValue<boolean>('scm.showInputActionButton');
		if (!this.toolbar || !showInputActionButton || this.toolbar?.isEmpty() === true) {
			return 0;
		}

		return this.toolbar.dropdownActions.length === 0 ?
			26 /* 22px action + 4px margin */ :
			39 /* 35px action + 4px margin */;
	}

	clearValidation(): void {
		this.validationContextView?.close();
		this.validationContextView = undefined;
		this.validationHasFocus = false;
	}

	dispose(): void {
		this.input = undefined;
		this.repositoryDisposables.dispose();
		this.clearValidation();
		this.disposables.dispose();
	}
}

export class SCMViewPane extends ViewPane {

	private _onDidLayout: Emitter<void>;
	private layoutCache: ISCMLayout;

	private treeScrollTop: number | undefined;
	private treeContainer!: HTMLElement;
	private tree!: WorkbenchCompressibleAsyncDataTree<ISCMViewService, TreeElement, FuzzyScore>;

	private listLabels!: ResourceLabels;
	private inputRenderer!: InputRenderer;
	private actionButtonRenderer!: ActionButtonRenderer;

	private _viewMode: ViewMode;
	get viewMode(): ViewMode { return this._viewMode; }
	set viewMode(mode: ViewMode) {
		if (this._viewMode === mode) {
			return;
		}

		this._viewMode = mode;

		// Update sort key based on view mode
		this.viewSortKey = this.getViewSortKey();

		this.updateChildren();
		this.onDidActiveEditorChange();
		this._onDidChangeViewMode.fire(mode);
		this.viewModeContextKey.set(mode);

		this.updateIndentStyles(this.themeService.getFileIconTheme());
		this.storageService.store(`scm.viewMode`, mode, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private readonly _onDidChangeViewMode = new Emitter<ViewMode>();
	readonly onDidChangeViewMode = this._onDidChangeViewMode.event;

	private _viewSortKey: ViewSortKey;
	get viewSortKey(): ViewSortKey { return this._viewSortKey; }
	set viewSortKey(sortKey: ViewSortKey) {
		if (this._viewSortKey === sortKey) {
			return;
		}

		this._viewSortKey = sortKey;

		this.updateChildren();
		this.viewSortKeyContextKey.set(sortKey);
		this._onDidChangeViewSortKey.fire(sortKey);

		if (this._viewMode === ViewMode.List) {
			this.storageService.store(`scm.viewSortKey`, sortKey, StorageScope.WORKSPACE, StorageTarget.USER);
		}
	}

	private readonly _onDidChangeViewSortKey = new Emitter<ViewSortKey>();
	readonly onDidChangeViewSortKey = this._onDidChangeViewSortKey.event;

	private readonly items = new DisposableMap<ISCMRepository, IDisposable>();
	private readonly visibilityDisposables = new DisposableStore();

	private readonly treeOperationSequencer = new Sequencer();
	private readonly revealResourceThrottler = new Throttler();
	private readonly updateChildrenThrottler = new Throttler();

	private historyProviderDataSource!: SCMTreeHistoryProviderDataSource;

	private viewModeContextKey: IContextKey<ViewMode>;
	private viewSortKeyContextKey: IContextKey<ViewSortKey>;
	private areAllRepositoriesCollapsedContextKey: IContextKey<boolean>;
	private isAnyRepositoryCollapsibleContextKey: IContextKey<boolean>;

	private scmProviderContextKey: IContextKey<string | undefined>;
	private scmProviderRootUriContextKey: IContextKey<string | undefined>;
	private scmProviderHasRootUriContextKey: IContextKey<boolean>;

	private readonly disposables = new DisposableStore();

	constructor(
		options: IViewPaneOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IMenuService private readonly menuService: IMenuService,
		@ISCMService private readonly scmService: ISCMService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
		@IStorageService private readonly storageService: IStorageService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super({ ...options, titleMenuId: MenuId.SCMTitle }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

		// View mode and sort key
		this._viewMode = this.getViewMode();
		this._viewSortKey = this.getViewSortKey();

		// Context Keys
		this.viewModeContextKey = ContextKeys.SCMViewMode.bindTo(contextKeyService);
		this.viewModeContextKey.set(this._viewMode);
		this.viewSortKeyContextKey = ContextKeys.SCMViewSortKey.bindTo(contextKeyService);
		this.viewSortKeyContextKey.set(this.viewSortKey);
		this.areAllRepositoriesCollapsedContextKey = ContextKeys.SCMViewAreAllRepositoriesCollapsed.bindTo(contextKeyService);
		this.isAnyRepositoryCollapsibleContextKey = ContextKeys.SCMViewIsAnyRepositoryCollapsible.bindTo(contextKeyService);
		this.scmProviderContextKey = ContextKeys.SCMProvider.bindTo(contextKeyService);
		this.scmProviderRootUriContextKey = ContextKeys.SCMProviderRootUri.bindTo(contextKeyService);
		this.scmProviderHasRootUriContextKey = ContextKeys.SCMProviderHasRootUri.bindTo(contextKeyService);

		this._onDidLayout = new Emitter<void>();
		this.layoutCache = { height: undefined, width: undefined, onDidChange: this._onDidLayout.event };

		this.storageService.onDidChangeValue(StorageScope.WORKSPACE, undefined, this.disposables)(e => {
			switch (e.key) {
				case 'scm.viewMode':
					this.viewMode = this.getViewMode();
					break;
				case 'scm.viewSortKey':
					this.viewSortKey = this.getViewSortKey();
					break;
			}
		}, this, this.disposables);

		this.storageService.onWillSaveState(e => {
			this.viewMode = this.getViewMode();
			this.viewSortKey = this.getViewSortKey();

			this.storeTreeViewState();
		}, this, this.disposables);

		Event.any(this.scmService.onDidAddRepository, this.scmService.onDidRemoveRepository)(() => this._onDidChangeViewWelcomeState.fire(), this, this.disposables);

		this.disposables.add(this.revealResourceThrottler);
		this.disposables.add(this.updateChildrenThrottler);
	}

	protected override layoutBody(height: number | undefined = this.layoutCache.height, width: number | undefined = this.layoutCache.width): void {
		if (height === undefined) {
			return;
		}

		if (width !== undefined) {
			super.layoutBody(height, width);
		}

		this.layoutCache.height = height;
		this.layoutCache.width = width;
		this._onDidLayout.fire();

		this.treeContainer.style.height = `${height}px`;
		this.tree.layout(height, width);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// Tree
		this.treeContainer = append(container, $('.scm-view.show-file-icons'));
		this.treeContainer.classList.add('file-icon-themable-tree');
		this.treeContainer.classList.add('show-file-icons');

		const updateActionsVisibility = () => this.treeContainer.classList.toggle('show-actions', this.configurationService.getValue<boolean>('scm.alwaysShowActions'));
		Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.alwaysShowActions'), this.disposables)(updateActionsVisibility, this, this.disposables);
		updateActionsVisibility();

		const updateProviderCountVisibility = () => {
			const value = this.configurationService.getValue<'hidden' | 'auto' | 'visible'>('scm.providerCountBadge');
			this.treeContainer.classList.toggle('hide-provider-counts', value === 'hidden');
			this.treeContainer.classList.toggle('auto-provider-counts', value === 'auto');
		};
		Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.providerCountBadge'), this.disposables)(updateProviderCountVisibility, this, this.disposables);
		updateProviderCountVisibility();

		const viewState = this.loadTreeViewState();
		this.createTree(this.treeContainer, viewState);

		this.onDidChangeBodyVisibility(async visible => {
			if (visible) {
				this.treeOperationSequencer.queue(async () => {
					await this.tree.setInput(this.scmViewService, viewState);

					Event.filter(this.configurationService.onDidChangeConfiguration,
						e =>
							e.affectsConfiguration('scm.alwaysShowRepositories'),
						this.visibilityDisposables)
						(() => {
							this.updateActions();
							this.updateChildren();
						}, this, this.visibilityDisposables);

					Event.filter(this.configurationService.onDidChangeConfiguration,
						e =>
							e.affectsConfiguration('scm.inputMinLineCount') ||
							e.affectsConfiguration('scm.inputMaxLineCount') ||
							e.affectsConfiguration('scm.showActionButton') ||
							e.affectsConfiguration('scm.showIncomingChanges') ||
							e.affectsConfiguration('scm.showOutgoingChanges') ||
							e.affectsConfiguration('scm.showHistoryGraph'),
						this.visibilityDisposables)
						(() => this.updateChildren(), this, this.visibilityDisposables);

					Event.filter(this.configurationService.onDidChangeConfiguration,
						e => e.affectsConfiguration('scm.showChangesSummary'), this.visibilityDisposables)
						(() => {
							this.historyProviderDataSource.clearCache();
							this.updateChildren();
						}, this, this.visibilityDisposables);

					// Add visible repositories
					this.editorService.onDidActiveEditorChange(this.onDidActiveEditorChange, this, this.visibilityDisposables);
					this.scmViewService.onDidChangeVisibleRepositories(this.onDidChangeVisibleRepositories, this, this.visibilityDisposables);
					this.onDidChangeVisibleRepositories({ added: this.scmViewService.visibleRepositories, removed: Iterable.empty() });

					// Restore scroll position
					if (typeof this.treeScrollTop === 'number') {
						this.tree.scrollTop = this.treeScrollTop;
						this.treeScrollTop = undefined;
					}

					this.updateRepositoryCollapseAllContextKeys();
				});
			} else {
				this.visibilityDisposables.clear();
				this.onDidChangeVisibleRepositories({ added: Iterable.empty(), removed: [...this.items.keys()] });
				this.treeScrollTop = this.tree.scrollTop;

				this.updateRepositoryCollapseAllContextKeys();
			}
		}, this, this.disposables);

		this.disposables.add(this.instantiationService.createInstance(RepositoryVisibilityActionController));

		this.themeService.onDidFileIconThemeChange(this.updateIndentStyles, this, this.disposables);
		this.updateIndentStyles(this.themeService.getFileIconTheme());
	}

	private createTree(container: HTMLElement, viewState?: IAsyncDataTreeViewState): void {
		const overflowWidgetsDomNode = $('.scm-overflow-widgets-container.monaco-editor');

		this.inputRenderer = this.instantiationService.createInstance(InputRenderer, this.layoutCache, overflowWidgetsDomNode, (input, height) => {
			try {
				// Attempt to update the input element height. There is an
				// edge case where the input has already been disposed and
				// updating the height would fail.
				this.tree.updateElementHeight(input, height);
			}
			catch { }
		});
		this.actionButtonRenderer = this.instantiationService.createInstance(ActionButtonRenderer);

		this.listLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this.disposables.add(this.listLabels);

		const resourceActionRunner = new RepositoryPaneActionRunner(() => this.getSelectedResources());
		resourceActionRunner.onWillRun(() => this.tree.domFocus(), this, this.disposables);
		this.disposables.add(resourceActionRunner);

		const historyItemGroupActionRunner = new HistoryItemGroupActionRunner();
		historyItemGroupActionRunner.onWillRun(() => this.tree.domFocus(), this, this.disposables);
		this.disposables.add(historyItemGroupActionRunner);

		const historyItemActionRunner = new HistoryItemActionRunner();
		historyItemActionRunner.onWillRun(() => this.tree.domFocus(), this, this.disposables);
		this.disposables.add(historyItemActionRunner);

		const historyItemHoverDelegate = this.instantiationService.createInstance(HistoryItemHoverDelegate, this.viewDescriptorService.getViewLocationById(this.id), this.layoutService.getSideBarPosition());
		this.disposables.add(historyItemHoverDelegate);

		this.historyProviderDataSource = this.instantiationService.createInstance(SCMTreeHistoryProviderDataSource, () => this.viewMode);
		this.disposables.add(this.historyProviderDataSource);

		const treeDataSource = this.instantiationService.createInstance(SCMTreeDataSource, () => this.viewMode, this.historyProviderDataSource);
		this.disposables.add(treeDataSource);

		this.tree = this.instantiationService.createInstance(
			WorkbenchCompressibleAsyncDataTree,
			'SCM Tree Repo',
			container,
			new ListDelegate(this.inputRenderer),
			new SCMTreeCompressionDelegate(),
			[
				this.inputRenderer,
				this.actionButtonRenderer,
				this.instantiationService.createInstance(RepositoryRenderer, MenuId.SCMTitle, getActionViewItemProvider(this.instantiationService)),
				this.instantiationService.createInstance(ResourceGroupRenderer, getActionViewItemProvider(this.instantiationService)),
				this.instantiationService.createInstance(ResourceRenderer, () => this.viewMode, this.listLabels, getActionViewItemProvider(this.instantiationService), resourceActionRunner),
				this.instantiationService.createInstance(HistoryItemGroupRenderer, historyItemGroupActionRunner),
				this.instantiationService.createInstance(HistoryItemRenderer, historyItemActionRunner, getActionViewItemProvider(this.instantiationService)),
				this.instantiationService.createInstance(HistoryItem2Renderer, historyItemHoverDelegate),
				this.instantiationService.createInstance(HistoryItemChangeRenderer, () => this.viewMode, this.listLabels),
				this.instantiationService.createInstance(SeparatorRenderer, (repository) => this.getHistoryItemGroupFilterActions(repository)),
			],
			treeDataSource,
			{
				horizontalScrolling: false,
				setRowLineHeight: false,
				transformOptimization: false,
				filter: new SCMTreeFilter(),
				dnd: new SCMTreeDragAndDrop(this.instantiationService),
				identityProvider: new SCMResourceIdentityProvider(),
				sorter: new SCMTreeSorter(() => this.viewMode, () => this.viewSortKey),
				keyboardNavigationLabelProvider: this.instantiationService.createInstance(SCMTreeKeyboardNavigationLabelProvider, () => this.viewMode),
				overrideStyles: this.getLocationBasedColors().listOverrideStyles,
				collapseByDefault: (e: unknown) => {
					// Repository, Resource Group, Resource Folder (Tree), History Item Change Folder (Tree)
					if (isSCMRepository(e) || isSCMResourceGroup(e) || isSCMResourceNode(e) || isSCMHistoryItemChangeNode(e)) {
						return false;
					}

					// History Item Group, History Item, or History Item Change
					return (viewState?.expanded ?? []).indexOf(getSCMResourceId(e as TreeElement)) === -1;
				},
				accessibilityProvider: this.instantiationService.createInstance(SCMAccessibilityProvider)
			}) as WorkbenchCompressibleAsyncDataTree<ISCMViewService, TreeElement, FuzzyScore>;

		this.disposables.add(this.tree);

		this.tree.onDidOpen(this.open, this, this.disposables);
		this.tree.onContextMenu(this.onListContextMenu, this, this.disposables);
		this.tree.onDidScroll(this.inputRenderer.clearValidation, this.inputRenderer, this.disposables);
		Event.filter(this.tree.onDidChangeCollapseState, e => isSCMRepository(e.node.element?.element), this.disposables)(this.updateRepositoryCollapseAllContextKeys, this, this.disposables);

		append(container, overflowWidgetsDomNode);
	}

	private async open(e: IOpenEvent<TreeElement | undefined>): Promise<void> {
		if (!e.element) {
			return;
		} else if (isSCMRepository(e.element)) {
			this.scmViewService.focus(e.element);
			return;
		} else if (isSCMInput(e.element)) {
			this.scmViewService.focus(e.element.repository);

			const widget = this.inputRenderer.getRenderedInputWidget(e.element);

			if (widget) {
				widget.focus();
				this.tree.setFocus([], e.browserEvent);

				const selection = this.tree.getSelection();

				if (selection.length === 1 && selection[0] === e.element) {
					setTimeout(() => this.tree.setSelection([]));
				}
			}

			return;
		} else if (isSCMActionButton(e.element)) {
			this.scmViewService.focus(e.element.repository);

			// Focus the action button
			this.actionButtonRenderer.focusActionButton(e.element);
			this.tree.setFocus([], e.browserEvent);

			return;
		} else if (isSCMResourceGroup(e.element)) {
			const provider = e.element.provider;
			const repository = Iterable.find(this.scmService.repositories, r => r.provider === provider);
			if (repository) {
				this.scmViewService.focus(repository);
			}
			return;
		} else if (isSCMResource(e.element)) {
			if (e.element.command?.id === API_OPEN_EDITOR_COMMAND_ID || e.element.command?.id === API_OPEN_DIFF_EDITOR_COMMAND_ID) {
				if (isPointerEvent(e.browserEvent) && e.browserEvent.button === 1) {
					const resourceGroup = e.element.resourceGroup;
					const title = `${resourceGroup.provider.label}: ${resourceGroup.label}`;
					await OpenScmGroupAction.openMultiFileDiffEditor(this.editorService, title, resourceGroup.provider.rootUri, resourceGroup.id, {
						...e.editorOptions,
						viewState: {
							revealData: {
								resource: {
									original: e.element.multiDiffEditorOriginalUri,
									modified: e.element.multiDiffEditorModifiedUri,
								}
							}
						},
						preserveFocus: true,
					});
				} else {
					await this.commandService.executeCommand(e.element.command.id, ...(e.element.command.arguments || []), e);
				}
			} else {
				await e.element.open(!!e.editorOptions.preserveFocus);

				if (e.editorOptions.pinned) {
					const activeEditorPane = this.editorService.activeEditorPane;

					activeEditorPane?.group.pinEditor(activeEditorPane.input);
				}
			}

			const provider = e.element.resourceGroup.provider;
			const repository = Iterable.find(this.scmService.repositories, r => r.provider === provider);

			if (repository) {
				this.scmViewService.focus(repository);
			}
		} else if (isSCMResourceNode(e.element)) {
			const provider = e.element.context.provider;
			const repository = Iterable.find(this.scmService.repositories, r => r.provider === provider);
			if (repository) {
				this.scmViewService.focus(repository);
			}
			return;
		} else if (isSCMHistoryItemGroupTreeElement(e.element)) {
			this.scmViewService.focus(e.element.repository);
			return;
		} else if (isSCMHistoryItemTreeElement(e.element)) {
			this.scmViewService.focus(e.element.historyItemGroup.repository);
			return;
		} else if (isSCMHistoryItemViewModelTreeElement(e.element)) {
			const historyItem = e.element.historyItemViewModel.historyItem;
			const historyItemParentId = historyItem.parentIds.length > 0 ? historyItem.parentIds[0] : undefined;

			const historyProvider = e.element.repository.provider.historyProvider.get();
			const historyItemChanges = await historyProvider?.provideHistoryItemChanges(historyItem.id, historyItemParentId);
			if (historyItemChanges) {
				const title = `${historyItem.id.substring(0, 8)} - ${historyItem.message}`;

				const rootUri = e.element.repository.provider.rootUri;
				const multiDiffSourceUri = rootUri ?
					rootUri.with({ scheme: 'scm-history-item', path: `${rootUri.path}/${historyItem.id}..${historyItemParentId}` }) :
					URI.from({ scheme: 'scm-history-item', path: `${e.element.repository.provider.label}/${historyItem.id}..${historyItemParentId}` }, true);

				await this.commandService.executeCommand('_workbench.openMultiDiffEditor', { title, multiDiffSourceUri, resources: historyItemChanges });
			}

			this.scmViewService.focus(e.element.repository);
			return;
		} else if (isSCMHistoryItemChangeTreeElement(e.element)) {
			if (e.element.originalUri && e.element.modifiedUri) {
				await this.commandService.executeCommand(API_OPEN_DIFF_EDITOR_COMMAND_ID, ...toDiffEditorArguments(e.element.uri, e.element.originalUri, e.element.modifiedUri), e);
			}

			this.scmViewService.focus(e.element.historyItem.historyItemGroup.repository);
			return;
		} else if (isSCMHistoryItemChangeNode(e.element)) {
			this.scmViewService.focus(e.element.context.historyItemGroup.repository);
			return;
		}
	}

	private onDidActiveEditorChange(): void {
		if (!this.configurationService.getValue<boolean>('scm.autoReveal')) {
			return;
		}

		const uri = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });

		if (!uri) {
			return;
		}

		// Do not set focus/selection when the resource is already focused and selected
		if (this.tree.getFocus().some(e => isSCMResource(e) && this.uriIdentityService.extUri.isEqual(e.sourceUri, uri)) &&
			this.tree.getSelection().some(e => isSCMResource(e) && this.uriIdentityService.extUri.isEqual(e.sourceUri, uri))) {
			return;
		}

		this.revealResourceThrottler.queue(
			() => this.treeOperationSequencer.queue(
				async () => {
					for (const repository of this.scmViewService.visibleRepositories) {
						const item = this.items.get(repository);

						if (!item) {
							continue;
						}

						// go backwards from last group
						for (let j = repository.provider.groups.length - 1; j >= 0; j--) {
							const groupItem = repository.provider.groups[j];
							const resource = this.viewMode === ViewMode.Tree
								? groupItem.resourceTree.getNode(uri)?.element
								: groupItem.resources.find(r => this.uriIdentityService.extUri.isEqual(r.sourceUri, uri));

							if (resource) {
								await this.tree.expandTo(resource);
								this.tree.reveal(resource);

								this.tree.setSelection([resource]);
								this.tree.setFocus([resource]);
								return;
							}
						}
					}
				}));
	}

	private onDidChangeVisibleRepositories({ added, removed }: ISCMViewVisibleRepositoryChangeEvent): void {
		// Added repositories
		for (const repository of added) {
			const repositoryDisposables = new DisposableStore();

			repositoryDisposables.add(repository.provider.onDidChange(() => this.updateChildren(repository)));
			repositoryDisposables.add(repository.input.onDidChangeVisibility(() => this.updateChildren(repository)));
			repositoryDisposables.add(repository.provider.onDidChangeResourceGroups(() => this.updateChildren(repository)));

			repositoryDisposables.add(autorun(reader => {
				repository.provider.historyProvider.read(reader)?.currentHistoryItemGroup.read(reader);

				this.historyProviderDataSource.deleteCacheEntry(repository);
				this.historyProviderDataSource.deleteHistoryItemGroupFilter(repository);

				this.updateChildren(repository);
			}));

			const resourceGroupDisposables = repositoryDisposables.add(new DisposableMap<ISCMResourceGroup, IDisposable>());

			const onDidChangeResourceGroups = () => {
				for (const [resourceGroup] of resourceGroupDisposables) {
					if (!repository.provider.groups.includes(resourceGroup)) {
						resourceGroupDisposables.deleteAndDispose(resourceGroup);
					}
				}

				for (const resourceGroup of repository.provider.groups) {
					if (!resourceGroupDisposables.has(resourceGroup)) {
						const disposableStore = new DisposableStore();

						disposableStore.add(resourceGroup.onDidChange(() => this.updateChildren(repository)));
						disposableStore.add(resourceGroup.onDidChangeResources(() => this.updateChildren(repository)));
						resourceGroupDisposables.set(resourceGroup, disposableStore);
					}
				}
			};

			repositoryDisposables.add(repository.provider.onDidChangeResourceGroups(onDidChangeResourceGroups));
			onDidChangeResourceGroups();

			this.items.set(repository, repositoryDisposables);
		}

		// Removed repositories
		for (const repository of removed) {
			this.historyProviderDataSource.deleteCacheEntry(repository);
			this.items.deleteAndDispose(repository);
		}

		this.updateChildren();
		this.onDidActiveEditorChange();
	}

	private onListContextMenu(e: ITreeContextMenuEvent<TreeElement | null>): void {
		if (!e.element) {
			const menu = this.menuService.getMenuActions(Menus.ViewSort, this.contextKeyService);
			const actions: IAction[] = [];
			createAndFillInContextMenuActions(menu, actions);

			return this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => actions,
				onHide: () => { }
			});
		}

		const element = e.element;
		let context: any = element;
		let actions: IAction[] = [];
		let actionRunner: IActionRunner = new RepositoryPaneActionRunner(() => this.getSelectedResources());

		if (isSCMRepository(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.provider);
			const menu = menus.repositoryContextMenu;
			context = element.provider;
			actionRunner = new RepositoryActionRunner(() => this.getSelectedRepositories());
			actions = collectContextMenuActions(menu);
		} else if (isSCMInput(element) || isSCMActionButton(element)) {
			// noop
		} else if (isSCMResourceGroup(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.provider);
			const menu = menus.getResourceGroupMenu(element);
			actions = collectContextMenuActions(menu);
		} else if (isSCMResource(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.resourceGroup.provider);
			const menu = menus.getResourceMenu(element);
			actions = collectContextMenuActions(menu);
		} else if (isSCMResourceNode(element)) {
			if (element.element) {
				const menus = this.scmViewService.menus.getRepositoryMenus(element.element.resourceGroup.provider);
				const menu = menus.getResourceMenu(element.element);
				actions = collectContextMenuActions(menu);
			} else {
				const menus = this.scmViewService.menus.getRepositoryMenus(element.context.provider);
				const menu = menus.getResourceFolderMenu(element.context);
				actions = collectContextMenuActions(menu);
			}
		} else if (isSCMHistoryItemGroupTreeElement(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.repository.provider);
			const menu = menus.historyProviderMenu?.getHistoryItemGroupContextMenu(element);

			if (menu) {
				actionRunner = new HistoryItemGroupActionRunner();
				createAndFillInContextMenuActions(menu, { shouldForwardArgs: true }, actions);
			}
		} else if (isSCMHistoryItemTreeElement(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.historyItemGroup.repository.provider);
			const menu = menus.historyProviderMenu?.getHistoryItemMenu(element);
			if (menu) {
				actionRunner = new HistoryItemActionRunner();
				actions = collectContextMenuActions(menu);
			}
		} else if (isSCMHistoryItemViewModelTreeElement(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.repository.provider);
			const menu = menus.historyProviderMenu?.getHistoryItemMenu2(element);
			if (menu) {
				actionRunner = new HistoryItemActionRunner2(() => this.getSelectedHistoryItems());
				actions = collectContextMenuActions(menu);
			}
		}

		actionRunner.onWillRun(() => this.tree.domFocus());

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => context,
			actionRunner
		});
	}

	private getSelectedRepositories(): ISCMRepository[] {
		const focusedRepositories = this.tree.getFocus().filter(r => !!r && isSCMRepository(r))! as ISCMRepository[];
		const selectedRepositories = this.tree.getSelection().filter(r => !!r && isSCMRepository(r))! as ISCMRepository[];

		return Array.from(new Set<ISCMRepository>([...focusedRepositories, ...selectedRepositories]));
	}

	private getSelectedResources(): (ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>)[] {
		return this.tree.getSelection()
			.filter(r => !!r && !isSCMResourceGroup(r))! as any;
	}

	private getSelectedHistoryItems(): SCMHistoryItemViewModelTreeElement[] {
		return this.tree.getSelection()
			.filter(r => !!r && isSCMHistoryItemViewModelTreeElement(r))!;
	}

	private getViewMode(): ViewMode {
		let mode = this.configurationService.getValue<'tree' | 'list'>('scm.defaultViewMode') === 'list' ? ViewMode.List : ViewMode.Tree;
		const storageMode = this.storageService.get(`scm.viewMode`, StorageScope.WORKSPACE) as ViewMode;
		if (typeof storageMode === 'string') {
			mode = storageMode;
		}

		return mode;
	}

	private getViewSortKey(): ViewSortKey {
		// Tree
		if (this._viewMode === ViewMode.Tree) {
			return ViewSortKey.Path;
		}

		// List
		let viewSortKey: ViewSortKey;
		const viewSortKeyString = this.configurationService.getValue<'path' | 'name' | 'status'>('scm.defaultViewSortKey');
		switch (viewSortKeyString) {
			case 'name':
				viewSortKey = ViewSortKey.Name;
				break;
			case 'status':
				viewSortKey = ViewSortKey.Status;
				break;
			default:
				viewSortKey = ViewSortKey.Path;
				break;
		}

		const storageSortKey = this.storageService.get(`scm.viewSortKey`, StorageScope.WORKSPACE) as ViewSortKey;
		if (typeof storageSortKey === 'string') {
			viewSortKey = storageSortKey;
		}

		return viewSortKey;
	}

	private loadTreeViewState(): IAsyncDataTreeViewState | undefined {
		const storageViewState = this.storageService.get('scm.viewState2', StorageScope.WORKSPACE);
		if (!storageViewState) {
			return undefined;
		}

		try {
			const treeViewState = JSON.parse(storageViewState);
			return treeViewState;
		} catch {
			return undefined;
		}
	}

	private storeTreeViewState() {
		if (this.tree) {
			this.storageService.store('scm.viewState2', JSON.stringify(this.tree.getViewState()), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
	}

	private updateChildren(element?: ISCMRepository) {
		this.updateChildrenThrottler.queue(
			() => this.treeOperationSequencer.queue(
				async () => {
					const focusedInput = this.inputRenderer.getFocusedInput();

					if (element && this.tree.hasNode(element)) {
						// Refresh specific repository
						await this.tree.updateChildren(element);
					} else {
						// Refresh the entire tree
						await this.tree.updateChildren(undefined);
					}

					if (focusedInput) {
						this.inputRenderer.getRenderedInputWidget(focusedInput)?.focus();
					}

					this.updateScmProviderContextKeys();
					this.updateRepositoryCollapseAllContextKeys();
				}));
	}

	private updateIndentStyles(theme: IFileIconTheme): void {
		this.treeContainer.classList.toggle('list-view-mode', this.viewMode === ViewMode.List);
		this.treeContainer.classList.toggle('tree-view-mode', this.viewMode === ViewMode.Tree);
		this.treeContainer.classList.toggle('align-icons-and-twisties', (this.viewMode === ViewMode.List && theme.hasFileIcons) || (theme.hasFileIcons && !theme.hasFolderIcons));
		this.treeContainer.classList.toggle('hide-arrows', this.viewMode === ViewMode.Tree && theme.hidesExplorerArrows === true);
	}

	private updateScmProviderContextKeys(): void {
		const alwaysShowRepositories = this.configurationService.getValue<boolean>('scm.alwaysShowRepositories');

		if (!alwaysShowRepositories && this.items.size === 1) {
			const provider = Iterable.first(this.items.keys())!.provider;
			this.scmProviderContextKey.set(provider.contextValue);
			this.scmProviderRootUriContextKey.set(provider.rootUri?.toString());
			this.scmProviderHasRootUriContextKey.set(!!provider.rootUri);
		} else {
			this.scmProviderContextKey.set(undefined);
			this.scmProviderRootUriContextKey.set(undefined);
			this.scmProviderHasRootUriContextKey.set(false);
		}
	}

	private updateRepositoryCollapseAllContextKeys(): void {
		if (!this.isBodyVisible() || this.items.size === 1) {
			this.isAnyRepositoryCollapsibleContextKey.set(false);
			this.areAllRepositoriesCollapsedContextKey.set(false);
			return;
		}

		this.isAnyRepositoryCollapsibleContextKey.set(this.scmViewService.visibleRepositories.some(r => this.tree.hasNode(r) && this.tree.isCollapsible(r)));
		this.areAllRepositoriesCollapsedContextKey.set(this.scmViewService.visibleRepositories.every(r => this.tree.hasNode(r) && (!this.tree.isCollapsible(r) || this.tree.isCollapsed(r))));
	}

	collapseAllRepositories(): void {
		for (const repository of this.scmViewService.visibleRepositories) {
			if (this.tree.isCollapsible(repository)) {
				this.tree.collapse(repository);
			}
		}
	}

	expandAllRepositories(): void {
		for (const repository of this.scmViewService.visibleRepositories) {
			if (this.tree.isCollapsible(repository)) {
				this.tree.expand(repository);
			}
		}
	}

	focusPreviousInput(): void {
		this.treeOperationSequencer.queue(() => this.focusInput(-1));
	}

	focusNextInput(): void {
		this.treeOperationSequencer.queue(() => this.focusInput(1));
	}

	private async focusInput(delta: number): Promise<void> {
		if (!this.scmViewService.focusedRepository ||
			this.scmViewService.visibleRepositories.length === 0) {
			return;
		}

		let input = this.scmViewService.focusedRepository.input;
		const repositories = this.scmViewService.visibleRepositories;

		// One visible repository and the input is already focused
		if (repositories.length === 1 && this.inputRenderer.getRenderedInputWidget(input)?.hasFocus() === true) {
			return;
		}

		// Multiple visible repositories and the input already focused
		if (repositories.length > 1 && this.inputRenderer.getRenderedInputWidget(input)?.hasFocus() === true) {
			const focusedRepositoryIndex = repositories.indexOf(this.scmViewService.focusedRepository);
			const newFocusedRepositoryIndex = rot(focusedRepositoryIndex + delta, repositories.length);
			input = repositories[newFocusedRepositoryIndex].input;
		}

		await this.tree.expandTo(input);

		this.tree.reveal(input);
		this.inputRenderer.getRenderedInputWidget(input)?.focus();
	}

	focusPreviousResourceGroup(): void {
		this.treeOperationSequencer.queue(() => this.focusResourceGroup(-1));
	}

	focusNextResourceGroup(): void {
		this.treeOperationSequencer.queue(() => this.focusResourceGroup(1));
	}

	private async focusResourceGroup(delta: number): Promise<void> {
		if (!this.scmViewService.focusedRepository ||
			this.scmViewService.visibleRepositories.length === 0) {
			return;
		}

		const treeHasDomFocus = isActiveElement(this.tree.getHTMLElement());
		const resourceGroups = this.scmViewService.focusedRepository.provider.groups;
		const focusedResourceGroup = this.tree.getFocus().find(e => isSCMResourceGroup(e));
		const focusedResourceGroupIndex = treeHasDomFocus && focusedResourceGroup ? resourceGroups.indexOf(focusedResourceGroup) : -1;

		let resourceGroupNext: ISCMResourceGroup | undefined;

		if (focusedResourceGroupIndex === -1) {
			// First visible resource group
			for (const resourceGroup of resourceGroups) {
				if (this.tree.hasNode(resourceGroup)) {
					resourceGroupNext = resourceGroup;
					break;
				}
			}
		} else {
			// Next/Previous visible resource group
			let index = rot(focusedResourceGroupIndex + delta, resourceGroups.length);
			while (index !== focusedResourceGroupIndex) {
				if (this.tree.hasNode(resourceGroups[index])) {
					resourceGroupNext = resourceGroups[index];
					break;
				}
				index = rot(index + delta, resourceGroups.length);
			}
		}

		if (resourceGroupNext) {
			await this.tree.expandTo(resourceGroupNext);
			this.tree.reveal(resourceGroupNext);

			this.tree.setSelection([resourceGroupNext]);
			this.tree.setFocus([resourceGroupNext]);
			this.tree.domFocus();
		}
	}

	private getHistoryItemGroupFilterActions(repository: ISCMRepository): IAction[] {
		const currentHistoryItemGroup = repository.provider.historyProvider.get()?.currentHistoryItemGroup?.get();
		if (!currentHistoryItemGroup) {
			return [];
		}

		const toHistoryItemGroupFilterAction = (
			historyItemGroupId: string,
			historyItemGroupName: string): IAction => {
			return toAction({
				id: `workbench.scm.action.toggleHistoryItemGroupVisibility.${repository.id}.${historyItemGroupId}`,
				label: historyItemGroupName,
				checked: !this.historyProviderDataSource.getHistoryItemGroupFilter(repository).has(historyItemGroupId),
				run: () => {
					this.historyProviderDataSource.toggleHistoryItemGroupFilter(repository, historyItemGroupId);
					this.historyProviderDataSource.deleteCacheEntry(repository);

					this.updateChildren(repository);
				}
			});
		};

		const actions: IAction[] = [];
		if (currentHistoryItemGroup.remote) {
			actions.push(toHistoryItemGroupFilterAction(currentHistoryItemGroup.remote.id, currentHistoryItemGroup.remote.name));
		}

		if (currentHistoryItemGroup.base) {
			actions.push(toHistoryItemGroupFilterAction(currentHistoryItemGroup.base.id, currentHistoryItemGroup.base.name));
		}

		return actions;
	}

	override shouldShowWelcome(): boolean {
		return this.scmService.repositoryCount === 0;
	}

	override getActionsContext(): unknown {
		return this.scmViewService.visibleRepositories.length === 1 ? this.scmViewService.visibleRepositories[0].provider : undefined;
	}

	override focus(): void {
		super.focus();

		this.treeOperationSequencer.queue(() => {
			return new Promise<void>(resolve => {
				if (this.isExpanded()) {
					if (this.tree.getFocus().length === 0) {
						for (const repository of this.scmViewService.visibleRepositories) {
							const widget = this.inputRenderer.getRenderedInputWidget(repository.input);

							if (widget) {
								widget.focus();
								resolve();
								return;
							}
						}
					}

					this.tree.domFocus();
					resolve();
				}
			});
		});
	}

	override dispose(): void {
		this.visibilityDisposables.dispose();
		this.disposables.dispose();
		this.items.dispose();
		super.dispose();
	}
}

class SCMTreeHistoryProviderDataSource extends Disposable {
	private readonly _cache = new Map<ISCMRepository, ISCMHistoryProviderCacheEntry>();
	private readonly _historyItemGroupFilter = new Map<ISCMRepository, Set<string>>();

	constructor(
		private readonly viewMode: () => ViewMode,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUriIdentityService private uriIdentityService: IUriIdentityService,
	) {
		super();
	}

	clearCache(): void {
		this._cache.clear();
	}

	deleteCacheEntry(repository: ISCMRepository): void {
		this._cache.delete(repository);
	}

	async getHistoryItemGroups(element: ISCMRepository): Promise<SCMHistoryItemGroupTreeElement[]> {
		const { showIncomingChanges, showOutgoingChanges, showHistoryGraph } = this._getConfiguration();

		const scmProvider = element.provider;
		const historyProvider = scmProvider.historyProvider.get();
		const currentHistoryItemGroup = historyProvider?.currentHistoryItemGroup.get();

		if (!historyProvider || !currentHistoryItemGroup || (showIncomingChanges === 'never' && showOutgoingChanges === 'never') || showHistoryGraph) {
			return [];
		}

		const children: SCMHistoryItemGroupTreeElement[] = [];
		const historyProviderCacheEntry = this._getCacheEntry(element);

		let incomingHistoryItemGroup = historyProviderCacheEntry?.incomingHistoryItemGroup;
		let outgoingHistoryItemGroup = historyProviderCacheEntry?.outgoingHistoryItemGroup;

		if (!incomingHistoryItemGroup && !outgoingHistoryItemGroup) {
			// Common ancestor, ahead, behind
			const ancestor = await historyProvider.resolveHistoryItemGroupCommonAncestor(currentHistoryItemGroup.id, currentHistoryItemGroup.remote?.id);
			if (!ancestor) {
				return [];
			}

			// Only show "Incoming" node if there is a base branch
			incomingHistoryItemGroup = currentHistoryItemGroup.remote ? {
				id: currentHistoryItemGroup.remote.id,
				label: currentHistoryItemGroup.remote.name,
				ariaLabel: localize('incomingChangesAriaLabel', "Incoming changes from {0}", currentHistoryItemGroup.remote.name),
				icon: Codicon.arrowCircleDown,
				direction: 'incoming',
				ancestor: ancestor.id,
				count: ancestor.behind,
				repository: element,
				type: 'historyItemGroup'
			} : undefined;

			outgoingHistoryItemGroup = {
				id: currentHistoryItemGroup.id,
				label: currentHistoryItemGroup.name,
				ariaLabel: localize('outgoingChangesAriaLabel', "Outgoing changes to {0}", currentHistoryItemGroup.name),
				icon: Codicon.arrowCircleUp,
				direction: 'outgoing',
				ancestor: ancestor.id,
				count: ancestor.ahead,
				repository: element,
				type: 'historyItemGroup'
			};

			this._updateCacheEntry(element, {
				incomingHistoryItemGroup,
				outgoingHistoryItemGroup
			});
		}

		// Incoming
		if (incomingHistoryItemGroup &&
			(showIncomingChanges === 'always' ||
				(showIncomingChanges === 'auto' && (incomingHistoryItemGroup.count ?? 0) > 0))) {
			children.push(incomingHistoryItemGroup);
		}

		// Outgoing
		if (outgoingHistoryItemGroup &&
			(showOutgoingChanges === 'always' ||
				(showOutgoingChanges === 'auto' && (outgoingHistoryItemGroup.count ?? 0) > 0))) {
			children.push(outgoingHistoryItemGroup);
		}

		return children;
	}

	getHistoryItemGroupFilter(element: ISCMRepository): Set<string> {
		return this._historyItemGroupFilter.get(element) ?? new Set<string>();
	}

	deleteHistoryItemGroupFilter(repository: ISCMRepository): void {
		this._historyItemGroupFilter.delete(repository);
	}

	toggleHistoryItemGroupFilter(element: ISCMRepository, historyItemGroupId: string): void {
		const filters = this.getHistoryItemGroupFilter(element);
		if (!filters.delete(historyItemGroupId)) {
			filters.add(historyItemGroupId);
		}

		this._historyItemGroupFilter.set(element, filters);
	}

	async getHistoryItems(element: SCMHistoryItemGroupTreeElement): Promise<SCMHistoryItemTreeElement[]> {
		const repository = element.repository;
		const historyProvider = repository.provider.historyProvider.get();

		if (!historyProvider) {
			return [];
		}

		const historyProviderCacheEntry = this._getCacheEntry(repository);
		const historyItemsMap = historyProviderCacheEntry.historyItems;
		let historyItemsElement = historyProviderCacheEntry.historyItems.get(element.id);

		if (!historyItemsElement) {
			const historyItems = await historyProvider.provideHistoryItems(element.id, { limit: { id: element.ancestor } }) ?? [];

			// All Changes
			const { showChangesSummary } = this._getConfiguration();
			const allChanges = showChangesSummary && historyItems.length >= 2 ?
				await historyProvider.provideHistoryItemSummary(historyItems[0].id, element.ancestor) : undefined;

			historyItemsElement = [allChanges, historyItems];
			this._updateCacheEntry(repository, {
				historyItems: historyItemsMap.set(element.id, historyItemsElement)
			});
		}

		const children: SCMHistoryItemTreeElement[] = [];
		if (historyItemsElement[0]) {
			children.push({
				...historyItemsElement[0],
				icon: historyItemsElement[0].icon ?? Codicon.files,
				message: localize('allChanges', "All Changes"),
				historyItemGroup: element,
				type: 'allChanges'
			} satisfies SCMHistoryItemTreeElement);
		}

		children.push(...historyItemsElement[1]
			.map(historyItem => ({
				...historyItem,
				historyItemGroup: element,
				type: 'historyItem'
			} satisfies SCMHistoryItemTreeElement)));

		return children;
	}

	async getHistoryItems2(element: ISCMRepository): Promise<SCMHistoryItemViewModelTreeElement[]> {
		const { showHistoryGraph } = this._getConfiguration();

		const historyProvider = element.provider.historyProvider.get();
		const currentHistoryItemGroup = historyProvider?.currentHistoryItemGroup.get();

		if (!historyProvider || !currentHistoryItemGroup || !showHistoryGraph) {
			return [];
		}

		const historyProviderCacheEntry = this._getCacheEntry(element);
		let historyItemsElement = historyProviderCacheEntry.historyItems2.get(element.id);
		const historyItemsMap = historyProviderCacheEntry.historyItems2;

		if (!historyItemsElement) {
			const historyItemGroupIds = [
				currentHistoryItemGroup.id,
				...currentHistoryItemGroup.remote ? [currentHistoryItemGroup.remote.id] : [],
				...currentHistoryItemGroup.base ? [currentHistoryItemGroup.base.id] : [],
			];

			// Common ancestor of current, remote, base independent of the select history item group
			const ancestor = await historyProvider.resolveHistoryItemGroupCommonAncestor2(historyItemGroupIds);
			if (!ancestor) {
				return [];
			}

			// History items of selected history item groups
			const filters = this.getHistoryItemGroupFilter(element);
			historyItemsElement = await historyProvider.provideHistoryItems2({
				historyItemGroupIds: historyItemGroupIds.filter(id => !filters.has(id)),
				limit: { id: ancestor }
			}) ?? [];

			this._updateCacheEntry(element, {
				historyItems2: historyItemsMap.set(element.id, historyItemsElement)
			});
		}

		// If we only have one history item that contains all the
		// labels (current, remote, base), we don't need to show it
		if (historyItemsElement.length === 1) {
			const currentHistoryItemGroupLabels = [
				currentHistoryItemGroup.name,
				...currentHistoryItemGroup.remote ? [currentHistoryItemGroup.remote.name] : [],
				...currentHistoryItemGroup.base ? [currentHistoryItemGroup.base.name] : [],
			];

			const labels = (historyItemsElement[0].labels ?? [])
				.map(l => l.title);

			if (equals(currentHistoryItemGroupLabels.sort(), labels.sort())) {
				return [];
			}
		}

		// Create the color map
		const colorMap = new Map<string, ColorIdentifier>([
			[currentHistoryItemGroup.name, historyItemGroupLocal]
		]);
		if (currentHistoryItemGroup.remote) {
			colorMap.set(currentHistoryItemGroup.remote.name, historyItemGroupRemote);
		}
		if (currentHistoryItemGroup.base) {
			colorMap.set(currentHistoryItemGroup.base.name, historyItemGroupBase);
		}

		return toISCMHistoryItemViewModelArray(historyItemsElement, colorMap)
			.map(historyItemViewModel => ({
				repository: element,
				historyItemViewModel,
				type: 'historyItem2'
			}) satisfies SCMHistoryItemViewModelTreeElement);
	}

	async getHistoryItemChanges(element: SCMHistoryItemTreeElement): Promise<(SCMHistoryItemChangeTreeElement | IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>)[]> {
		const repository = element.historyItemGroup.repository;
		const historyProvider = repository.provider.historyProvider.get();

		if (!historyProvider) {
			return [];
		}

		const historyProviderCacheEntry = this._getCacheEntry(repository);
		const historyItemChangesMap = historyProviderCacheEntry.historyItemChanges;

		const historyItemParentId = element.parentIds.length > 0 ? element.parentIds[0] : undefined;
		let historyItemChanges = historyItemChangesMap.get(`${element.id}/${historyItemParentId}`);

		if (!historyItemChanges) {
			const historyItemParentId = element.parentIds.length > 0 ? element.parentIds[0] : undefined;
			historyItemChanges = await historyProvider.provideHistoryItemChanges(element.id, historyItemParentId) ?? [];
			this._updateCacheEntry(repository, {
				historyItemChanges: historyItemChangesMap.set(`${element.id}/${historyItemParentId}`, historyItemChanges)
			});
		}

		if (this.viewMode() === ViewMode.List) {
			// List
			return historyItemChanges.map(change => ({
				...change,
				historyItem: element,
				type: 'historyItemChange'
			}));
		}

		// Tree
		const tree = new ResourceTree<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>(element, repository.provider.rootUri ?? URI.file('/'), this.uriIdentityService.extUri);
		for (const change of historyItemChanges) {
			tree.add(change.uri, {
				...change,
				historyItem: element,
				type: 'historyItemChange'
			});
		}

		const children: (SCMHistoryItemChangeTreeElement | IResourceNode<SCMHistoryItemChangeTreeElement, SCMHistoryItemTreeElement>)[] = [];
		for (const node of tree.root.children) {
			children.push(node.element ?? node);
		}

		return children;
	}

	private _getCacheEntry(repository: ISCMRepository): ISCMHistoryProviderCacheEntry {
		let entry = this._cache.get(repository);

		if (!entry) {
			entry = {
				incomingHistoryItemGroup: undefined,
				outgoingHistoryItemGroup: undefined,
				historyItems: new Map<string, [ISCMHistoryItem | undefined, ISCMHistoryItem[]]>(),
				historyItems2: new Map<string, ISCMHistoryItem[]>(),
				historyItemChanges: new Map<string, ISCMHistoryItemChange[]>()
			} satisfies ISCMHistoryProviderCacheEntry;

			this._cache.set(repository, entry);
		}

		return entry;
	}

	private _updateCacheEntry(repository: ISCMRepository, entry: Partial<ISCMHistoryProviderCacheEntry>): void {
		this._cache.set(repository, {
			...this._getCacheEntry(repository),
			...entry
		});
	}

	private _getConfiguration(): {
		showChangesSummary: boolean;
		showIncomingChanges: ShowChangesSetting;
		showOutgoingChanges: ShowChangesSetting;
		showHistoryGraph: boolean;
	} {
		return {
			showChangesSummary: this.configurationService.getValue<boolean>('scm.showChangesSummary'),
			showIncomingChanges: this.configurationService.getValue<ShowChangesSetting>('scm.showIncomingChanges'),
			showOutgoingChanges: this.configurationService.getValue<ShowChangesSetting>('scm.showOutgoingChanges'),
			showHistoryGraph: this.configurationService.getValue<boolean>('scm.showHistoryGraph')
		};
	}
}

class SCMTreeDataSource extends Disposable implements IAsyncDataSource<ISCMViewService, TreeElement> {
	constructor(
		private readonly viewMode: () => ViewMode,
		private readonly historyProviderDataSource: SCMTreeHistoryProviderDataSource,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISCMViewService private readonly scmViewService: ISCMViewService
	) {
		super();
	}

	async getChildren(inputOrElement: ISCMViewService | TreeElement): Promise<Iterable<TreeElement>> {
		const repositoryCount = this.scmViewService.visibleRepositories.length;

		const showActionButton = this.configurationService.getValue<boolean>('scm.showActionButton') === true;
		const alwaysShowRepositories = this.configurationService.getValue<boolean>('scm.alwaysShowRepositories') === true;

		if (isSCMViewService(inputOrElement) && (repositoryCount > 1 || alwaysShowRepositories)) {
			return this.scmViewService.visibleRepositories;
		} else if ((isSCMViewService(inputOrElement) && repositoryCount === 1 && !alwaysShowRepositories) || isSCMRepository(inputOrElement)) {
			const children: TreeElement[] = [];

			inputOrElement = isSCMRepository(inputOrElement) ? inputOrElement : this.scmViewService.visibleRepositories[0];
			const actionButton = inputOrElement.provider.actionButton;
			const resourceGroups = inputOrElement.provider.groups;

			// SCM Input
			if (inputOrElement.input.visible) {
				children.push(inputOrElement.input);
			}

			// Action Button
			if (showActionButton && actionButton) {
				children.push({
					type: 'actionButton',
					repository: inputOrElement,
					button: actionButton
				} satisfies ISCMActionButton);
			}

			// ResourceGroups
			const hasSomeChanges = resourceGroups.some(group => group.resources.length > 0);
			if (hasSomeChanges || (repositoryCount === 1 && (!showActionButton || !actionButton))) {
				children.push(...resourceGroups);
			}

			// History item groups
			const historyItemGroups = await this.historyProviderDataSource.getHistoryItemGroups(inputOrElement);

			// Incoming/Outgoing Separator
			if (historyItemGroups.length > 0) {
				let label = localize('syncSeparatorHeader', "Incoming/Outgoing");
				let ariaLabel = localize('syncSeparatorHeaderAriaLabel', "Incoming and outgoing changes");

				const incomingHistoryItems = historyItemGroups.find(g => g.direction === 'incoming');
				const outgoingHistoryItems = historyItemGroups.find(g => g.direction === 'outgoing');

				if (incomingHistoryItems && !outgoingHistoryItems) {
					label = localize('syncIncomingSeparatorHeader', "Incoming");
					ariaLabel = localize('syncIncomingSeparatorHeaderAriaLabel', "Incoming changes");
				} else if (!incomingHistoryItems && outgoingHistoryItems) {
					label = localize('syncOutgoingSeparatorHeader', "Outgoing");
					ariaLabel = localize('syncOutgoingSeparatorHeaderAriaLabel', "Outgoing changes");
				}

				children.push({ label, ariaLabel, repository: inputOrElement, type: 'separator' } satisfies SCMViewSeparatorElement);
			}

			children.push(...historyItemGroups);

			// History items
			const historyItems = await this.historyProviderDataSource.getHistoryItems2(inputOrElement);
			if (historyItems.length > 0) {
				const label = localize('syncSeparatorHeader', "Incoming/Outgoing");
				const ariaLabel = localize('syncSeparatorHeaderAriaLabel', "Incoming and outgoing changes");

				children.push({ label, ariaLabel, repository: inputOrElement, type: 'separator' } satisfies SCMViewSeparatorElement);
			}

			children.push(...historyItems);

			return children;
		} else if (isSCMResourceGroup(inputOrElement)) {
			if (this.viewMode() === ViewMode.List) {
				// Resources (List)
				return inputOrElement.resources;
			} else if (this.viewMode() === ViewMode.Tree) {
				// Resources (Tree)
				const children: TreeElement[] = [];
				for (const node of inputOrElement.resourceTree.root.children) {
					children.push(node.element && node.childrenCount === 0 ? node.element : node);
				}

				return children;
			}
		} else if (isSCMResourceNode(inputOrElement) || isSCMHistoryItemChangeNode(inputOrElement)) {
			// Resources (Tree), History item changes (Tree)
			const children: TreeElement[] = [];
			for (const node of inputOrElement.children) {
				children.push(node.element && node.childrenCount === 0 ? node.element : node);
			}

			return children;
		} else if (isSCMHistoryItemGroupTreeElement(inputOrElement)) {
			// History item group
			return this.historyProviderDataSource.getHistoryItems(inputOrElement);
		} else if (isSCMHistoryItemTreeElement(inputOrElement)) {
			// History item changes (List/Tree)
			return this.historyProviderDataSource.getHistoryItemChanges(inputOrElement);
		}

		return [];
	}

	getParent(element: TreeElement): ISCMViewService | TreeElement {
		if (isSCMResourceNode(element)) {
			if (element.parent === element.context.resourceTree.root) {
				return element.context;
			} else if (element.parent) {
				return element.parent;
			} else {
				throw new Error('Invalid element passed to getParent');
			}
		} else if (isSCMResource(element)) {
			if (this.viewMode() === ViewMode.List) {
				return element.resourceGroup;
			}

			const node = element.resourceGroup.resourceTree.getNode(element.sourceUri);
			const result = node?.parent;

			if (!result) {
				throw new Error('Invalid element passed to getParent');
			}

			if (result === element.resourceGroup.resourceTree.root) {
				return element.resourceGroup;
			}

			return result;
		} else if (isSCMInput(element)) {
			return element.repository;
		} else if (isSCMResourceGroup(element)) {
			const repository = this.scmViewService.visibleRepositories.find(r => r.provider === element.provider);
			if (!repository) {
				throw new Error('Invalid element passed to getParent');
			}

			return repository;
		} else {
			throw new Error('Unexpected call to getParent');
		}
	}

	hasChildren(inputOrElement: ISCMViewService | TreeElement): boolean {
		if (isSCMViewService(inputOrElement)) {
			return this.scmViewService.visibleRepositories.length !== 0;
		} else if (isSCMRepository(inputOrElement)) {
			return true;
		} else if (isSCMInput(inputOrElement)) {
			return false;
		} else if (isSCMActionButton(inputOrElement)) {
			return false;
		} else if (isSCMResourceGroup(inputOrElement)) {
			return true;
		} else if (isSCMResource(inputOrElement)) {
			return false;
		} else if (ResourceTree.isResourceNode(inputOrElement)) {
			return inputOrElement.childrenCount > 0;
		} else if (isSCMHistoryItemGroupTreeElement(inputOrElement)) {
			return true;
		} else if (isSCMHistoryItemTreeElement(inputOrElement)) {
			return true;
		} else if (isSCMHistoryItemViewModelTreeElement(inputOrElement)) {
			return false;
		} else if (isSCMHistoryItemChangeTreeElement(inputOrElement)) {
			return false;
		} else if (isSCMViewSeparator(inputOrElement)) {
			return false;
		} else {
			throw new Error('hasChildren not implemented.');
		}
	}
}

export class SCMActionButton implements IDisposable {
	private button: Button | ButtonWithDescription | ButtonWithDropdown | undefined;
	private readonly disposables = new MutableDisposable<DisposableStore>();

	constructor(
		private readonly container: HTMLElement,
		private readonly contextMenuService: IContextMenuService,
		private readonly commandService: ICommandService,
		private readonly notificationService: INotificationService
	) {
	}

	dispose(): void {
		this.disposables?.dispose();
	}

	setButton(button: ISCMActionButtonDescriptor | undefined): void {
		// Clear old button
		this.clear();
		if (!button) {
			return;
		}

		if (button.secondaryCommands?.length) {
			const actions: IAction[] = [];
			for (let index = 0; index < button.secondaryCommands.length; index++) {
				const commands = button.secondaryCommands[index];
				for (const command of commands) {
					actions.push(new Action(command.id, command.title, undefined, true, async () => await this.executeCommand(command.id, ...(command.arguments || []))));
				}
				if (commands.length) {
					actions.push(new Separator());
				}
			}
			// Remove last separator
			actions.pop();

			// ButtonWithDropdown
			this.button = new ButtonWithDropdown(this.container, {
				actions: actions,
				addPrimaryActionToDropdown: false,
				contextMenuProvider: this.contextMenuService,
				title: button.command.tooltip,
				supportIcons: true,
				...defaultButtonStyles
			});
		} else {
			// Button
			this.button = new Button(this.container, { supportIcons: true, supportShortLabel: !!button.description, title: button.command.tooltip, ...defaultButtonStyles });
		}

		this.button.enabled = button.enabled;
		this.button.label = button.command.title;
		if (this.button instanceof Button && button.description) {
			this.button.labelShort = button.description;
		}
		this.button.onDidClick(async () => await this.executeCommand(button.command.id, ...(button.command.arguments || [])), null, this.disposables.value);

		this.disposables.value!.add(this.button);
	}

	focus(): void {
		this.button?.focus();
	}

	private clear(): void {
		this.disposables.value = new DisposableStore();
		this.button = undefined;
		clearNode(this.container);
	}

	private async executeCommand(commandId: string, ...args: any[]): Promise<void> {
		try {
			await this.commandService.executeCommand(commandId, ...args);
		} catch (ex) {
			this.notificationService.error(ex);
		}
	}
}

// Override styles in selections.ts
registerThemingParticipant((theme, collector) => {
	const selectionBackgroundColor = theme.getColor(selectionBackground);

	if (selectionBackgroundColor) {
		// Override inactive selection bg
		const inputBackgroundColor = theme.getColor(inputBackground);
		if (inputBackgroundColor) {
			collector.addRule(`.scm-view .scm-editor-container .monaco-editor-background { background-color: ${inputBackgroundColor}; } `);
			collector.addRule(`.scm-view .scm-editor-container .monaco-editor .selected-text { background-color: ${inputBackgroundColor.transparent(0.4)}; }`);
		}

		// Override selected fg
		const inputForegroundColor = theme.getColor(inputForeground);
		if (inputForegroundColor) {
			collector.addRule(`.scm-view .scm-editor-container .monaco-editor .view-line span.inline-selected-text { color: ${inputForegroundColor}; }`);
		}

		collector.addRule(`.scm-view .scm-editor-container .monaco-editor .focused .selected-text { background-color: ${selectionBackgroundColor}; }`);
	} else {
		// Use editor selection color if theme has not set a selection background color
		collector.addRule(`.scm-view .scm-editor-container .monaco-editor .focused .selected-text { background-color: ${theme.getColor(editorSelectionBackground)}; }`);
	}
});
