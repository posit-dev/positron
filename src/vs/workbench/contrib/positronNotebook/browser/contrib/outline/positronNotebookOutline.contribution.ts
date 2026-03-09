/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../../../common/contributions.js';
import { IEditorPane } from '../../../../../common/editor.js';
import {
	IBreadcrumbsDataSource, IBreadcrumbsOutlineElement,
	IOutline, IOutlineComparator, IOutlineCreator, IOutlineListConfig, IOutlineService,
	IQuickPickDataSource, IQuickPickOutlineElement,
	OutlineChangeEvent, OutlineConfigCollapseItemsValues, OutlineConfigKeys, OutlineTarget,
} from '../../../../../services/outline/browser/outline.js';
import { IEditorService, SIDE_GROUP } from '../../../../../services/editor/common/editorService.js';
import { NotebookOutlineConstants } from '../../../../notebook/browser/viewModel/notebookOutlineEntryFactory.js';
import { getMarkdownHeadersInCell } from '../../../../notebook/browser/viewModel/foldingModel.js';
import { NotebookCellsChangeType } from '../../../../notebook/common/notebookCommon.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IEditorOptions } from '../../../../../../platform/editor/common/editor.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IListVirtualDelegate, IKeyboardNavigationLabelProvider } from '../../../../../../base/browser/ui/list/list.js';
import { IListAccessibilityProvider } from '../../../../../../base/browser/ui/list/listWidget.js';
import { IDataSource, ITreeNode, ITreeRenderer } from '../../../../../../base/browser/ui/tree/tree.js';
import { FuzzyScore, createMatches } from '../../../../../../base/common/filters.js';
import { IconLabel } from '../../../../../../base/browser/ui/iconLabel/iconLabel.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { IWorkbenchDataTreeOptions } from '../../../../../../platform/list/browser/listService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { getIconClassesForLanguageId } from '../../../../../../editor/common/services/getIconClasses.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { renderAsPlaintext } from '../../../../../../base/browser/markdownRenderer.js';
import { safeIntl } from '../../../../../../base/common/date.js';
import { localize } from '../../../../../../nls.js';
import { Delayer } from '../../../../../../base/common/async.js';
import { CellKind, IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookInstance } from '../../PositronNotebookInstance.js';
import { PositronNotebookEditor } from '../../PositronNotebookEditor.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../common/positronNotebookCommon.js';
import { CellSelectionType, getActiveCell } from '../../selectionMachine.js';
import { slugify } from '../../../../markdown/browser/markedGfmHeadingIdPlugin.js';

// --- Section B: PositronOutlineEntry ---

/**
 * Custom outline entry for Positron notebooks. Holds a direct reference to the
 * Positron cell rather than the upstream ICellViewModel, giving full type safety
 * and decoupling from upstream notebook internals.
 */
export class PositronOutlineEntry {
	private _children: PositronOutlineEntry[] = [];
	private _parent: PositronOutlineEntry | undefined;

	get icon(): ThemeIcon {
		return this.cell.kind === CellKind.Markup ? Codicon.markdown : Codicon.code;
	}

	get parent(): PositronOutlineEntry | undefined { return this._parent; }
	get children(): readonly PositronOutlineEntry[] { return this._children; }

	constructor(
		readonly index: number,
		readonly level: number,
		readonly cell: IPositronNotebookCell,
		readonly label: string,
		readonly headingId: string | undefined,
	) { }

	addChild(entry: PositronOutlineEntry): void {
		this._children.push(entry);
		entry._parent = this;
	}

	/** Recursively flatten the tree into a list. */
	asFlatList(bucket: PositronOutlineEntry[]): void {
		bucket.push(this);
		for (const child of this._children) {
			child.asFlatList(bucket);
		}
	}
}

// --- Section C: Pure functions (exported for testing) ---

/**
 * Extract markdown headers from cell content, with a fallback to HTML heading
 * tags when the marked lexer finds no headers. Matches upstream behavior from
 * notebookOutlineEntryFactory.ts (getMarkdownHeadersInCellFallbackToHtmlTags).
 */
export function getMarkdownHeaders(content: string): { depth: number; text: string }[] {
	const headers = Array.from(getMarkdownHeadersInCell(content));
	if (headers.length > 0) {
		return headers;
	}
	// Fallback: detect HTML heading tags
	const match = content.match(/<h([1-6]).*?>(.*?)<\/h\1>/i);
	if (match) {
		headers.push({ depth: parseInt(match[1]), text: match[2].trim() });
	}
	return headers;
}

/** Return the first non-empty line from text, or empty string. */
export function getFirstNonEmptyLine(text: string): string {
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}
	return '';
}

/**
 * Build outline entries from Positron notebook cells.
 *
 * - Markdown cells: extract headers (h1-h6) with HTML fallback, with per-cell
 *   slug de-duplication matching the renderer. Non-header markdown cells get
 *   a first-line plaintext preview.
 * - Code cells: first non-empty line as preview.
 * - Raw cells: skipped.
 *
 * Returns a flat list. Use buildTree() to create the hierarchy.
 */
export function buildOutlineEntries(
	cells: readonly IPositronNotebookCell[],
): PositronOutlineEntry[] {
	const entries: PositronOutlineEntry[] = [];
	let index = 0;

	for (const cell of cells) {
		if (cell.isRawCell()) {
			continue;
		}

		const content = cell.getContent();

		if (cell.isMarkdownCell()) {
			const headers = getMarkdownHeaders(content);
			if (headers.length > 0) {
				// Track slug duplicates per cell, matching the renderer's behavior.
				const slugCounter = new Map<string, number>();
				for (const { depth, text } of headers) {
					let headingSlug = slugify(text);
					const existing = slugCounter.get(headingSlug);
					if (existing !== undefined) {
						slugCounter.set(headingSlug, existing + 1);
						headingSlug = headingSlug + '-' + (existing + 1);
					} else {
						slugCounter.set(headingSlug, 0);
					}
					entries.push(new PositronOutlineEntry(index++, depth, cell, text, headingSlug));
				}
			} else {
				// Non-header markdown: first-line plaintext preview.
				const firstLine = getFirstNonEmptyLine(content);
				let preview = renderAsPlaintext({ value: firstLine }).trim();
				if (preview.length === 0) {
					preview = localize('positronNotebook.outline.emptyMarkdown', "empty markdown cell");
				}
				entries.push(new PositronOutlineEntry(index++, NotebookOutlineConstants.NonHeaderOutlineLevel, cell, preview, undefined));
			}
		} else if (cell.isCodeCell()) {
			let preview = getFirstNonEmptyLine(content);
			if (preview.length === 0) {
				preview = localize('positronNotebook.outline.emptyCode', "empty cell");
			}
			entries.push(new PositronOutlineEntry(index++, NotebookOutlineConstants.NonHeaderOutlineLevel, cell, preview, undefined));
		}
	}
	return entries;
}

/**
 * Build a tree from a flat list of entries based on header levels.
 * Returns the root-level entries with children nested appropriately.
 */
export function buildTree(flatEntries: PositronOutlineEntry[]): PositronOutlineEntry[] {
	if (flatEntries.length === 0) {
		return [];
	}
	const result: PositronOutlineEntry[] = [flatEntries[0]];
	const parentStack: PositronOutlineEntry[] = [flatEntries[0]];

	for (let i = 1; i < flatEntries.length; i++) {
		const entry = flatEntries[i];
		while (true) {
			if (parentStack.length === 0) {
				result.push(entry);
				parentStack.push(entry);
				break;
			}
			const parent = parentStack[parentStack.length - 1];
			if (parent.level < entry.level) {
				parent.addChild(entry);
				parentStack.push(entry);
				break;
			} else {
				parentStack.pop();
			}
		}
	}
	return result;
}

/**
 * Walk the DOM subtree to find an element with the given ID.
 * Avoids querySelector which is discouraged in this codebase.
 */
function findElementById(root: HTMLElement, id: string): HTMLElement | null {
	if (root.id === id) {
		return root;
	}
	const children = root.children;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (isHTMLElement(child)) {
			const found = findElementById(child, id);
			if (found) {
				return found;
			}
		}
	}
	return null;
}

// --- Section D: Renderer, delegate, comparator, accessibility ---

class PositronOutlineTemplate {
	static readonly templateId = 'PositronNotebookOutlineRenderer';
	constructor(
		readonly container: HTMLElement,
		readonly iconClass: HTMLElement,
		readonly iconLabel: IconLabel,
	) { }
}

class PositronOutlineRenderer implements ITreeRenderer<PositronOutlineEntry, FuzzyScore, PositronOutlineTemplate> {
	readonly templateId = PositronOutlineTemplate.templateId;

	constructor(
		@IThemeService private readonly _themeService: IThemeService,
	) { }

	renderTemplate(container: HTMLElement): PositronOutlineTemplate {
		container.classList.add('notebook-outline-element', 'show-file-icons');
		const iconClass = document.createElement('div');
		container.append(iconClass);
		const iconLabel = new IconLabel(container, { supportHighlights: true });
		return new PositronOutlineTemplate(container, iconClass, iconLabel);
	}

	renderElement(node: ITreeNode<PositronOutlineEntry, FuzzyScore>, _index: number, template: PositronOutlineTemplate): void {
		const entry = node.element;
		const extraClasses: string[] = [];

		// Icon: use language file icon for code cells, theme icon for headers
		const isCodeCell = entry.cell.kind === CellKind.Code;
		if (isCodeCell && this._themeService.getFileIconTheme().hasFileIcons) {
			template.iconClass.className = '';
			extraClasses.push(...getIconClassesForLanguageId(entry.cell.model.language ?? ''));
		} else {
			template.iconClass.className = 'element-icon ' + ThemeIcon.asClassNameArray(entry.icon).join(' ');
		}

		template.iconLabel.setLabel(' ' + entry.label, undefined, {
			matches: createMatches(node.filterData),
			labelEscapeNewLines: true,
			extraClasses,
		});
	}

	disposeTemplate(template: PositronOutlineTemplate): void {
		template.iconLabel.dispose();
	}
}

class PositronOutlineVirtualDelegate implements IListVirtualDelegate<PositronOutlineEntry> {
	getHeight(_element: PositronOutlineEntry): number {
		return 22;
	}
	getTemplateId(_element: PositronOutlineEntry): string {
		return PositronOutlineTemplate.templateId;
	}
}

class PositronOutlineAccessibility implements IListAccessibilityProvider<PositronOutlineEntry> {
	getAriaLabel(element: PositronOutlineEntry): string | null {
		return element.label;
	}
	getWidgetAriaLabel(): string {
		return '';
	}
}

class PositronOutlineNavigationLabel implements IKeyboardNavigationLabelProvider<PositronOutlineEntry> {
	getKeyboardNavigationLabel(element: PositronOutlineEntry): { toString(): string | undefined } | undefined {
		return element.label;
	}
}

class PositronOutlineComparator implements IOutlineComparator<PositronOutlineEntry> {
	private readonly _collator = safeIntl.Collator(undefined, { numeric: true });

	compareByPosition(a: PositronOutlineEntry, b: PositronOutlineEntry): number {
		return a.index - b.index;
	}
	compareByType(a: PositronOutlineEntry, b: PositronOutlineEntry): number {
		return a.cell.kind - b.cell.kind || this._collator.value.compare(a.label, b.label);
	}
	compareByName(a: PositronOutlineEntry, b: PositronOutlineEntry): number {
		return this._collator.value.compare(a.label, b.label);
	}
}

// --- Section E: Data sources (tree, quickpick, breadcrumbs) ---

class PositronOutlinePaneProvider implements IDataSource<PositronNotebookCellOutline, PositronOutlineEntry> {

	*getChildren(element: PositronNotebookCellOutline | PositronOutlineEntry): Iterable<PositronOutlineEntry> {
		const entries = element instanceof PositronNotebookCellOutline
			? element.entries
			: element.children;
		yield* entries;
	}
}

class PositronOutlineQuickPickProvider implements IQuickPickDataSource<PositronOutlineEntry> {
	constructor(private readonly _outline: PositronNotebookCellOutline) { }

	getQuickPickElements(): IQuickPickOutlineElement<PositronOutlineEntry>[] {
		const bucket: PositronOutlineEntry[] = [];
		for (const entry of this._outline.entries) {
			entry.asFlatList(bucket);
		}
		return bucket.map(element => ({
			element,
			label: `$(${element.icon.id}) ${element.label}`,
			ariaLabel: element.label,
		}));
	}
}

class PositronOutlineBreadcrumbsProvider implements IBreadcrumbsDataSource<PositronOutlineEntry> {
	constructor(private readonly _outline: PositronNotebookCellOutline) { }

	getBreadcrumbElements(): readonly IBreadcrumbsOutlineElement<PositronOutlineEntry>[] {
		const result: IBreadcrumbsOutlineElement<PositronOutlineEntry>[] = [];
		let candidate = this._outline.activeElement;
		while (candidate) {
			result.unshift({ element: candidate, label: candidate.label });
			candidate = candidate.parent;
		}
		return result;
	}
}

// --- Section F: The IOutline implementation ---

export class PositronNotebookCellOutline extends Disposable implements IOutline<PositronOutlineEntry> {
	readonly outlineKind = 'positronNotebookCells';

	private readonly _onDidChange = this._register(new Emitter<OutlineChangeEvent>());
	readonly onDidChange: Event<OutlineChangeEvent> = this._onDidChange.event;

	private readonly _modelDisposables = this._register(new DisposableStore());
	private readonly _delayerRecomputeState: Delayer<void>;

	readonly config: IOutlineListConfig<PositronOutlineEntry>;

	private _entries: PositronOutlineEntry[] = [];
	private _activeEntry: PositronOutlineEntry | undefined;

	get entries(): PositronOutlineEntry[] { return this._entries; }
	get activeElement(): PositronOutlineEntry | undefined { return this._activeEntry; }
	get isEmpty(): boolean { return this._entries.length === 0; }

	get uri(): URI | undefined {
		return this._notebook?.uri;
	}

	private get _notebook(): PositronNotebookInstance | undefined {
		return this._editor.notebookInstance;
	}

	constructor(
		private readonly _editor: PositronNotebookEditor,
		private readonly _target: OutlineTarget,
		@IEditorService private readonly _editorService: IEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super();

		this._delayerRecomputeState = this._register(new Delayer<void>(300));

		const treeDataSource = new PositronOutlinePaneProvider();
		const quickPickDataSource = new PositronOutlineQuickPickProvider(this);
		const breadcrumbsDataSource = new PositronOutlineBreadcrumbsProvider(this);
		const delegate = new PositronOutlineVirtualDelegate();
		const renderers = [this._instantiationService.createInstance(PositronOutlineRenderer)];
		const comparator = new PositronOutlineComparator();
		const options: IWorkbenchDataTreeOptions<PositronOutlineEntry, FuzzyScore> = {
			collapseByDefault: this._target === OutlineTarget.Breadcrumbs ||
				(this._target === OutlineTarget.OutlinePane &&
					this._configurationService.getValue(OutlineConfigKeys.collapseItems) === OutlineConfigCollapseItemsValues.Collapsed),
			expandOnlyOnTwistieClick: true,
			multipleSelectionSupport: false,
			accessibilityProvider: new PositronOutlineAccessibility(),
			identityProvider: { getId: element => element.cell.uri.toString() + ':' + element.index },
			keyboardNavigationLabelProvider: new PositronOutlineNavigationLabel(),
		};

		this.config = { treeDataSource, quickPickDataSource, breadcrumbsDataSource, delegate, renderers, comparator, options };

		this._initListeners();
		this._recomputeState();
	}

	private _initListeners(): void {
		const notebook = this._notebook;
		if (!notebook) {
			return;
		}

		// Rebuild when cells are added/removed/reordered.
		this._register(autorun(reader => {
			notebook.cells.read(reader);
			this._delayedRecomputeState();
		}));

		// Listen for cell content changes via the notebook text model.
		this._setupModelListeners(notebook);
		this._register(notebook.onDidChangeModel(() => {
			this._setupModelListeners(notebook);
		}));

		// Update active element when selection changes.
		this._register(autorun(reader => {
			const state = notebook.selectionStateMachine.state.read(reader);
			const activeCell = getActiveCell(state);
			this._recomputeActive(activeCell);
		}));

		// Refresh icons on theme change.
		this._register(this._themeService.onDidFileIconThemeChange(() => {
			this._onDidChange.fire({});
		}));
	}

	/**
	 * Subscribe to text model content changes so the outline refreshes when
	 * cell content is edited in place (not just when cells are added/removed).
	 */
	private _setupModelListeners(notebook: PositronNotebookInstance): void {
		this._modelDisposables.clear();
		const textModel = notebook.textModel;
		if (!textModel) {
			return;
		}

		this._modelDisposables.add(textModel.onDidChangeContent(contentChanges => {
			if (contentChanges.rawEvents.some(c =>
				c.kind === NotebookCellsChangeType.ChangeCellContent ||
				c.kind === NotebookCellsChangeType.Move ||
				c.kind === NotebookCellsChangeType.ModelChange)) {
				this._delayedRecomputeState();
			}
		}));
	}

	private _delayedRecomputeState(): void {
		this._delayerRecomputeState.trigger(() => this._recomputeState());
	}

	private _recomputeState(): void {
		const notebook = this._notebook;
		if (!notebook) {
			this._entries = [];
			this._onDidChange.fire({});
			return;
		}

		const cells = notebook.cells.get();

		// Build entries and tree.
		const flatEntries = buildOutlineEntries(cells);
		this._entries = buildTree(flatEntries);

		// Recompute active after rebuilding entries.
		const state = notebook.selectionStateMachine.state.get();
		const activeCell = getActiveCell(state);
		this._recomputeActive(activeCell);

		this._onDidChange.fire({});
	}

	private _recomputeActive(activeCell: IPositronNotebookCell | null): void {
		if (!activeCell) {
			if (this._activeEntry) {
				this._activeEntry = undefined;
				this._onDidChange.fire({ affectOnlyActiveElement: true });
			}
			return;
		}

		// Find the first entry matching this cell (for multi-heading markdown
		// cells, this is the first heading -- a documented v1 limitation).
		const found = this._findEntryForCell(activeCell);
		if (found !== this._activeEntry) {
			this._activeEntry = found;
			this._onDidChange.fire({ affectOnlyActiveElement: true });
		}
	}

	private _findEntryForCell(cell: IPositronNotebookCell): PositronOutlineEntry | undefined {
		for (const entry of this._entries) {
			const found = this._findInTree(entry, cell);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	private _findInTree(entry: PositronOutlineEntry, cell: IPositronNotebookCell): PositronOutlineEntry | undefined {
		if (entry.cell === cell) {
			return entry;
		}
		for (const child of entry.children) {
			const found = this._findInTree(child, cell);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	async reveal(entry: PositronOutlineEntry, options: IEditorOptions, sideBySide: boolean): Promise<void> {
		// Open the notebook at this cell.
		const notebookOptions = {
			...options,
			override: this._editor.input?.editorId,
		};
		await this._editorService.openEditor(
			{ resource: entry.cell.uri, options: notebookOptions },
			sideBySide ? SIDE_GROUP : undefined,
		);

		// Select and reveal the cell in the Positron notebook.
		entry.cell.select(CellSelectionType.Normal);
		await entry.cell.reveal({ reason: 'programmatic' });

		// For markdown headers, scroll to the specific heading element
		// using the entry's pre-computed heading DOM ID.
		if (entry.headingId && entry.cell.container) {
			const headingEl = findElementById(entry.cell.container, entry.headingId);
			headingEl?.scrollIntoView({ block: 'nearest' });
		}
	}

	preview(entry: PositronOutlineEntry): IDisposable {
		entry.cell.reveal({ reason: 'programmatic' });
		return toDisposable(() => { });
	}

	captureViewState(): IDisposable {
		const notebook = this._notebook;
		if (!notebook) {
			return toDisposable(() => { });
		}

		// Capture scroll position and active cell for restore.
		const scrollTop = notebook.cellsContainer?.scrollTop;
		const state = notebook.selectionStateMachine.state.get();
		const activeCell = getActiveCell(state);

		return toDisposable(() => {
			// Restore scroll position.
			if (scrollTop !== undefined && notebook.cellsContainer) {
				notebook.cellsContainer.scrollTop = scrollTop;
			}
			// Restore selection.
			activeCell?.select(CellSelectionType.Normal);
		});
	}
}

// --- Section G: The IOutlineCreator and registration ---

class PositronNotebookOutlineCreator implements IOutlineCreator<PositronNotebookEditor, PositronOutlineEntry> {
	readonly dispose: () => void;

	constructor(
		@IOutlineService outlineService: IOutlineService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		const reg = outlineService.registerOutlineCreator(this);
		this.dispose = () => reg.dispose();
	}

	matches(candidate: IEditorPane): candidate is PositronNotebookEditor {
		return candidate.getId() === POSITRON_NOTEBOOK_EDITOR_ID;
	}

	async createOutline(editor: PositronNotebookEditor, target: OutlineTarget, _cancelToken: CancellationToken): Promise<IOutline<PositronOutlineEntry> | undefined> {
		return this._instantiationService.createInstance(PositronNotebookCellOutline, editor, target);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PositronNotebookOutlineCreator, LifecyclePhase.Eventually);
