/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/panel';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { basename } from 'vs/base/common/resources';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { CommentNode, ICommentThreadChangedEvent, ResourceWithCommentThreads } from 'vs/workbench/contrib/comments/common/commentModel';
import { ICommentService, IWorkspaceCommentThreadsEvent } from 'vs/workbench/contrib/comments/browser/commentService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { CommentsList, COMMENTS_VIEW_TITLE, Filter } from 'vs/workbench/contrib/comments/browser/commentsTreeViewer';
import { IViewPaneOptions, FilterViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { CommentsViewFilterFocusContextKey, ICommentsView } from 'vs/workbench/contrib/comments/browser/comments';
import { CommentsFilters, CommentsFiltersChangeEvent } from 'vs/workbench/contrib/comments/browser/commentsViewActions';
import { Memento, MementoObject } from 'vs/workbench/common/memento';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { FilterOptions } from 'vs/workbench/contrib/comments/browser/commentsFilterOptions';
import { CommentThreadApplicability, CommentThreadState } from 'vs/editor/common/languages';
import { ITreeElement } from 'vs/base/browser/ui/tree/tree';
import { Iterable } from 'vs/base/common/iterator';
import { revealCommentThread } from 'vs/workbench/contrib/comments/browser/commentsController';
import { registerNavigableContainer } from 'vs/workbench/browser/actions/widgetNavigationCommands';
import { CommentsModel, ICommentsModel } from 'vs/workbench/contrib/comments/browser/commentsModel';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { AccessibilityVerbositySettingId } from 'vs/workbench/contrib/accessibility/browser/accessibilityConfiguration';
import { AccessibleViewAction } from 'vs/workbench/contrib/accessibility/browser/accessibleViewActions';

export const CONTEXT_KEY_HAS_COMMENTS = new RawContextKey<boolean>('commentsView.hasComments', false);
export const CONTEXT_KEY_SOME_COMMENTS_EXPANDED = new RawContextKey<boolean>('commentsView.someCommentsExpanded', false);
export const CONTEXT_KEY_COMMENT_FOCUSED = new RawContextKey<boolean>('commentsView.commentFocused', false);
const VIEW_STORAGE_ID = 'commentsViewState';

function createResourceCommentsIterator(model: ICommentsModel): Iterable<ITreeElement<ResourceWithCommentThreads | CommentNode>> {
	return Iterable.map(model.resourceCommentThreads, m => {
		const CommentNodeIt = Iterable.from(m.commentThreads);
		const children = Iterable.map(CommentNodeIt, r => ({ element: r }));

		return { element: m, children };
	});
}

export class CommentsPanel extends FilterViewPane implements ICommentsView {
	private treeLabels!: ResourceLabels;
	private tree: CommentsList | undefined;
	private treeContainer!: HTMLElement;
	private messageBoxContainer!: HTMLElement;
	private totalComments: number = 0;
	private readonly hasCommentsContextKey: IContextKey<boolean>;
	private readonly someCommentsExpandedContextKey: IContextKey<boolean>;
	private readonly commentsFocusedContextKey: IContextKey<boolean>;
	private readonly filter: Filter;
	readonly filters: CommentsFilters;

	private currentHeight = 0;
	private currentWidth = 0;
	private readonly viewState: MementoObject;
	private readonly stateMemento: Memento;
	private cachedFilterStats: { total: number; filtered: number } | undefined = undefined;

	readonly onDidChangeVisibility = this.onDidChangeBodyVisibility;

	get focusedCommentNode(): CommentNode | undefined {
		const focused = this.tree?.getFocus();
		if (focused?.length === 1 && focused[0] instanceof CommentNode) {
			return focused[0];
		}
		return undefined;
	}

	get focusedCommentInfo(): string | undefined {
		if (!this.focusedCommentNode) {
			return;
		}
		return this.getScreenReaderInfoForNode(this.focusedCommentNode);
	}

	focusNextNode(): void {
		if (!this.tree) {
			return;
		}
		const focused = this.tree.getFocus()?.[0];
		if (!focused) {
			return;
		}
		let next = this.tree.navigate(focused).next();
		while (next && !(next instanceof CommentNode)) {
			next = this.tree.navigate(next).next();
		}
		if (!next) {
			return;
		}
		this.tree.setFocus([next]);
	}

	focusPreviousNode(): void {
		if (!this.tree) {
			return;
		}
		const focused = this.tree.getFocus()?.[0];
		if (!focused) {
			return;
		}
		let previous = this.tree.navigate(focused).previous();
		while (previous && !(previous instanceof CommentNode)) {
			previous = this.tree.navigate(previous).previous();
		}
		if (!previous) {
			return;
		}
		this.tree.setFocus([previous]);
	}

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ICommentService private readonly commentService: ICommentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IStorageService storageService: IStorageService
	) {
		const stateMemento = new Memento(VIEW_STORAGE_ID, storageService);
		const viewState = stateMemento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		super({
			...options,
			filterOptions: {
				placeholder: nls.localize('comments.filter.placeholder', "Filter (e.g. text, author)"),
				ariaLabel: nls.localize('comments.filter.ariaLabel', "Filter comments"),
				history: viewState['filterHistory'] || [],
				text: viewState['filter'] || '',
				focusContextKey: CommentsViewFilterFocusContextKey.key
			}
		}, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
		this.hasCommentsContextKey = CONTEXT_KEY_HAS_COMMENTS.bindTo(contextKeyService);
		this.someCommentsExpandedContextKey = CONTEXT_KEY_SOME_COMMENTS_EXPANDED.bindTo(contextKeyService);
		this.commentsFocusedContextKey = CONTEXT_KEY_COMMENT_FOCUSED.bindTo(contextKeyService);
		this.stateMemento = stateMemento;
		this.viewState = viewState;

		this.filters = this._register(new CommentsFilters({
			showResolved: this.viewState['showResolved'] !== false,
			showUnresolved: this.viewState['showUnresolved'] !== false,
		}, this.contextKeyService));
		this.filter = new Filter(new FilterOptions(this.filterWidget.getFilterText(), this.filters.showResolved, this.filters.showUnresolved));

		this._register(this.filters.onDidChange((event: CommentsFiltersChangeEvent) => {
			if (event.showResolved || event.showUnresolved) {
				this.updateFilter();
			}
		}));
		this._register(this.filterWidget.onDidChangeFilterText(() => this.updateFilter()));
	}

	override saveState(): void {
		this.viewState['filter'] = this.filterWidget.getFilterText();
		this.viewState['filterHistory'] = this.filterWidget.getHistory();
		this.viewState['showResolved'] = this.filters.showResolved;
		this.viewState['showUnresolved'] = this.filters.showUnresolved;
		this.stateMemento.saveMemento();
		super.saveState();
	}

	override render(): void {
		super.render();
		this._register(registerNavigableContainer({
			name: 'commentsView',
			focusNotifiers: [this, this.filterWidget],
			focusNextWidget: () => {
				if (this.filterWidget.hasFocus()) {
					this.focus();
				}
			},
			focusPreviousWidget: () => {
				if (!this.filterWidget.hasFocus()) {
					this.focusFilter();
				}
			}
		}));
	}

	public focusFilter(): void {
		this.filterWidget.focus();
	}

	public clearFilterText(): void {
		this.filterWidget.setFilterText('');
	}

	public getFilterStats(): { total: number; filtered: number } {
		if (!this.cachedFilterStats) {
			this.cachedFilterStats = {
				total: this.totalComments,
				filtered: this.tree?.getVisibleItemCount() ?? 0
			};
		}

		return this.cachedFilterStats;
	}

	private updateFilter() {
		this.filter.options = new FilterOptions(this.filterWidget.getFilterText(), this.filters.showResolved, this.filters.showUnresolved);
		this.tree?.filterComments();

		this.cachedFilterStats = undefined;
		const { total, filtered } = this.getFilterStats();
		this.filterWidget.updateBadge(total === filtered || total === 0 ? undefined : nls.localize('showing filtered results', "Showing {0} of {1}", filtered, total));
		this.filterWidget.checkMoreFilters(!this.filters.showResolved || !this.filters.showUnresolved);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('comments-panel');

		const domContainer = dom.append(container, dom.$('.comments-panel-container'));

		this.treeContainer = dom.append(domContainer, dom.$('.tree-container'));
		this.treeContainer.classList.add('file-icon-themable-tree', 'show-file-icons');

		this.cachedFilterStats = undefined;
		this.createTree();
		this.createMessageBox(domContainer);

		this._register(this.commentService.onDidSetAllCommentThreads(this.onAllCommentsChanged, this));
		this._register(this.commentService.onDidUpdateCommentThreads(this.onCommentsUpdated, this));
		this._register(this.commentService.onDidDeleteDataProvider(this.onDataProviderDeleted, this));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				this.refresh();
			}
		}));

		this.renderComments();
	}

	public override focus(): void {
		super.focus();

		const element = this.tree?.getHTMLElement();
		if (element && dom.isActiveElement(element)) {
			return;
		}

		if (!this.commentService.commentsModel.hasCommentThreads() && this.messageBoxContainer) {
			this.messageBoxContainer.focus();
		} else if (this.tree) {
			this.tree.domFocus();
		}
	}

	private async renderComments(): Promise<void> {
		this.treeContainer.classList.toggle('hidden', !this.commentService.commentsModel.hasCommentThreads());
		this.renderMessage();
		await this.tree?.setChildren(null, createResourceCommentsIterator(this.commentService.commentsModel));
	}

	public collapseAll() {
		if (this.tree) {
			this.tree.collapseAll();
			this.tree.setSelection([]);
			this.tree.setFocus([]);
			this.tree.domFocus();
			this.tree.focusFirst();
		}
	}

	public expandAll() {
		if (this.tree) {
			this.tree.expandAll();
			this.tree.setSelection([]);
			this.tree.setFocus([]);
			this.tree.domFocus();
			this.tree.focusFirst();
		}
	}

	public get hasRendered(): boolean {
		return !!this.tree;
	}

	protected layoutBodyContent(height: number = this.currentHeight, width: number = this.currentWidth): void {
		if (this.messageBoxContainer) {
			this.messageBoxContainer.style.height = `${height}px`;
		}
		this.tree?.layout(height, width);
		this.currentHeight = height;
		this.currentWidth = width;
	}

	private createMessageBox(parent: HTMLElement): void {
		this.messageBoxContainer = dom.append(parent, dom.$('.message-box-container'));
		this.messageBoxContainer.setAttribute('tabIndex', '0');
	}

	private renderMessage(): void {
		this.messageBoxContainer.textContent = this.commentService.commentsModel.getMessage();
		this.messageBoxContainer.classList.toggle('hidden', this.commentService.commentsModel.hasCommentThreads());
	}

	private getScreenReaderInfoForNode(element: CommentNode, forAriaLabel?: boolean): string {
		let accessibleViewHint = '';
		if (forAriaLabel && this.configurationService.getValue(AccessibilityVerbositySettingId.Comments)) {
			const kbLabel = this.keybindingService.lookupKeybinding(AccessibleViewAction.id)?.getAriaLabel();
			accessibleViewHint = kbLabel ? nls.localize('acessibleViewHint', "Inspect this in the accessible view ({0}).\n", kbLabel) : nls.localize('acessibleViewHintNoKbOpen', "Inspect this in the accessible view via the command Open Accessible View which is currently not triggerable via keybinding.\n");
		}
		const replyCount = this.getReplyCountAsString(element, forAriaLabel);
		const replies = this.getRepliesAsString(element, forAriaLabel);
		if (element.range) {
			if (element.threadRelevance === CommentThreadApplicability.Outdated) {
				return accessibleViewHint + nls.localize('resourceWithCommentLabelOutdated',
					"Outdated from {0} at line {1} column {2} in {3},{4} comment: {5}",
					element.comment.userName,
					element.range.startLineNumber,
					element.range.startColumn,
					basename(element.resource),
					replyCount,
					(typeof element.comment.body === 'string') ? element.comment.body : element.comment.body.value
				) + replies;
			} else {
				return accessibleViewHint + nls.localize('resourceWithCommentLabel',
					"{0} at line {1} column {2} in {3},{4} comment: {5}",
					element.comment.userName,
					element.range.startLineNumber,
					element.range.startColumn,
					basename(element.resource),
					replyCount,
					(typeof element.comment.body === 'string') ? element.comment.body : element.comment.body.value,
				) + replies;
			}
		} else {
			if (element.threadRelevance === CommentThreadApplicability.Outdated) {
				return accessibleViewHint + nls.localize('resourceWithCommentLabelFileOutdated',
					"Outdated from {0} in {1},{2} comment: {3}",
					element.comment.userName,
					basename(element.resource),
					replyCount,
					(typeof element.comment.body === 'string') ? element.comment.body : element.comment.body.value
				) + replies;
			} else {
				return accessibleViewHint + nls.localize('resourceWithCommentLabelFile',
					"{0} in {1},{2} comment: {3}",
					element.comment.userName,
					basename(element.resource),
					replyCount,
					(typeof element.comment.body === 'string') ? element.comment.body : element.comment.body.value
				) + replies;
			}
		}
	}

	private getRepliesAsString(node: CommentNode, forAriaLabel?: boolean): string {
		if (!node.replies.length || forAriaLabel) {
			return '';
		}
		return '\n' + node.replies.map(reply => nls.localize('resourceWithRepliesLabel',
			"{0} {1}",
			reply.comment.userName,
			(typeof reply.comment.body === 'string') ? reply.comment.body : reply.comment.body.value)
		).join('\n');
	}

	private getReplyCountAsString(node: CommentNode, forAriaLabel?: boolean): string {
		return node.replies.length && !forAriaLabel ? nls.localize('replyCount', " {0} replies,", node.replies.length) : '';
	}

	private createTree(): void {
		this.treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, this));
		this.tree = this._register(this.instantiationService.createInstance(CommentsList, this.treeLabels, this.treeContainer, {
			overrideStyles: this.getLocationBasedColors().listOverrideStyles,
			selectionNavigation: true,
			filter: this.filter,
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: (item: CommentsModel | ResourceWithCommentThreads | CommentNode) => {
					return undefined;
				}
			},
			accessibilityProvider: {
				getAriaLabel: (element: any): string => {
					if (element instanceof CommentsModel) {
						return nls.localize('rootCommentsLabel', "Comments for current workspace");
					}
					if (element instanceof ResourceWithCommentThreads) {
						return nls.localize('resourceWithCommentThreadsLabel', "Comments in {0}, full path {1}", basename(element.resource), element.resource.fsPath);
					}
					if (element instanceof CommentNode) {
						return this.getScreenReaderInfoForNode(element, true);
					}
					return '';
				},
				getWidgetAriaLabel(): string {
					return COMMENTS_VIEW_TITLE.value;
				}
			}
		}));

		this._register(this.tree.onDidOpen(e => {
			this.openFile(e.element, e.editorOptions.pinned, e.editorOptions.preserveFocus, e.sideBySide);
		}));


		this._register(this.tree.onDidChangeModel(() => {
			this.updateSomeCommentsExpanded();
		}));
		this._register(this.tree.onDidChangeCollapseState(() => {
			this.updateSomeCommentsExpanded();
		}));
		this._register(this.tree.onDidFocus(() => this.commentsFocusedContextKey.set(true)));
		this._register(this.tree.onDidBlur(() => this.commentsFocusedContextKey.set(false)));
	}

	private openFile(element: any, pinned?: boolean, preserveFocus?: boolean, sideBySide?: boolean): void {
		if (!element) {
			return;
		}

		if (!(element instanceof ResourceWithCommentThreads || element instanceof CommentNode)) {
			return;
		}
		const threadToReveal = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].thread : element.thread;
		const commentToReveal = element instanceof ResourceWithCommentThreads ? element.commentThreads[0].comment : undefined;
		return revealCommentThread(this.commentService, this.editorService, this.uriIdentityService, threadToReveal, commentToReveal, false, pinned, preserveFocus, sideBySide);
	}

	private async refresh(): Promise<void> {
		if (!this.tree) {
			return;
		}
		if (this.isVisible()) {
			this.hasCommentsContextKey.set(this.commentService.commentsModel.hasCommentThreads());

			this.treeContainer.classList.toggle('hidden', !this.commentService.commentsModel.hasCommentThreads());
			this.cachedFilterStats = undefined;
			this.renderMessage();
			this.tree?.setChildren(null, createResourceCommentsIterator(this.commentService.commentsModel));

			if (this.tree.getSelection().length === 0 && this.commentService.commentsModel.hasCommentThreads()) {
				const firstComment = this.commentService.commentsModel.resourceCommentThreads[0].commentThreads[0];
				if (firstComment) {
					this.tree.setFocus([firstComment]);
					this.tree.setSelection([firstComment]);
				}
			}
		}
	}

	private onAllCommentsChanged(e: IWorkspaceCommentThreadsEvent): void {
		this.cachedFilterStats = undefined;
		this.totalComments += e.commentThreads.length;

		let unresolved = 0;
		for (const thread of e.commentThreads) {
			if (thread.state === CommentThreadState.Unresolved) {
				unresolved++;
			}
		}
		this.refresh();
	}

	private onCommentsUpdated(e: ICommentThreadChangedEvent): void {
		this.cachedFilterStats = undefined;

		this.totalComments += e.added.length;
		this.totalComments -= e.removed.length;

		let unresolved = 0;
		for (const resource of this.commentService.commentsModel.resourceCommentThreads) {
			for (const thread of resource.commentThreads) {
				if (thread.threadState === CommentThreadState.Unresolved) {
					unresolved++;
				}
			}
		}
		this.refresh();
	}

	private onDataProviderDeleted(owner: string | undefined): void {
		this.cachedFilterStats = undefined;
		this.totalComments = 0;
		this.refresh();
	}

	private updateSomeCommentsExpanded() {
		this.someCommentsExpandedContextKey.set(this.isSomeCommentsExpanded());
	}

	public areAllCommentsExpanded(): boolean {
		if (!this.tree) {
			return false;
		}
		const navigator = this.tree.navigate();
		while (navigator.next()) {
			if (this.tree.isCollapsed(navigator.current())) {
				return false;
			}
		}
		return true;
	}

	public isSomeCommentsExpanded(): boolean {
		if (!this.tree) {
			return false;
		}
		const navigator = this.tree.navigate();
		while (navigator.next()) {
			if (!this.tree.isCollapsed(navigator.current())) {
				return true;
			}
		}
		return false;
	}
}
