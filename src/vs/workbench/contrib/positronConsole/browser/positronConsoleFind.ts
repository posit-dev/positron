/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './positronConsoleFind.css';

import * as dom from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { SimpleFindWidget } from '../../codeEditor/browser/find/simpleFindWidget.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConsoleFindWidgetFactory } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { PositronConsoleFindInputFocused, PositronConsoleFindVisible } from '../../../common/contextkeys.js';

export const enum PositronConsoleFindCommandId {
	FindFocus = 'workbench.action.positronConsole.findFocus',
	FindHide = 'workbench.action.positronConsole.findHide',
	FindNext = 'workbench.action.positronConsole.findNext',
	FindPrevious = 'workbench.action.positronConsole.findPrevious',
	ToggleFindRegex = 'workbench.action.positronConsole.toggleFindRegex',
	ToggleFindWholeWord = 'workbench.action.positronConsole.toggleFindWholeWord',
	ToggleFindCaseSensitive = 'workbench.action.positronConsole.toggleFindCaseSensitive',
}

const POSITRON_CONSOLE_FIND_WIDGET_INITIAL_WIDTH = 419;
const MATCHES_LIMIT = 1000;

// Names for the CSS Custom Highlight API highlights.
// Note: CSS.highlights is global per-document, so only one widget's highlights
// are active at a time. The active console tab re-applies its highlights when
// it becomes visible (see ConsoleInstance's active-prop effect).
const HIGHLIGHT_ALL = 'positron-console-find-match';
const HIGHLIGHT_ACTIVE = 'positron-console-find-match-active';

/**
 * Check whether the CSS Custom Highlight API is available.
 */
function hasHighlightsApi(): boolean {
	return typeof CSS !== 'undefined' && typeof CSS.highlights !== 'undefined';
}

interface ISearchMatch {
	range: Range;
}

/**
 * PositronConsoleFindWidget - extends SimpleFindWidget to provide find/search
 * functionality for the Positron Console's DOM-rendered output.
 *
 * Uses a DOM TreeWalker to search rendered text directly, with CSS Custom
 * Highlight API for non-destructive match highlighting.
 */
export class PositronConsoleFindWidget extends SimpleFindWidget {

	private readonly _findInputFocused: IContextKey<boolean>;
	private readonly _findWidgetVisible: IContextKey<boolean>;
	private readonly _onDidHideEmitter = this._register(new Emitter<void>());
	readonly onDidHide = this._onDidHideEmitter.event;

	private _matches: ISearchMatch[] = [];
	private _currentMatchIndex: number = -1;

	constructor(
		@IContextViewService contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super({
			showCommonFindToggles: true,
			checkImeCompletionState: true,
			showResultCount: true,
			initialWidth: POSITRON_CONSOLE_FIND_WIDGET_INITIAL_WIDTH,
			enableSash: true,
			appendCaseSensitiveActionId: PositronConsoleFindCommandId.ToggleFindCaseSensitive,
			appendRegexActionId: PositronConsoleFindCommandId.ToggleFindRegex,
			appendWholeWordsActionId: PositronConsoleFindCommandId.ToggleFindWholeWord,
			previousMatchActionId: PositronConsoleFindCommandId.FindPrevious,
			nextMatchActionId: PositronConsoleFindCommandId.FindNext,
			closeWidgetActionId: PositronConsoleFindCommandId.FindHide,
			matchesLimit: MATCHES_LIMIT,
		}, contextViewService, contextKeyService, hoverService, keybindingService);

		this._findInputFocused = PositronConsoleFindInputFocused.bindTo(contextKeyService);
		this._findWidgetVisible = PositronConsoleFindVisible.bindTo(contextKeyService);

		// Stop mouse events from propagating through to the console instance.
		const innerDom = this.getDomNode().firstChild;
		if (innerDom) {
			this._register(dom.addDisposableListener(innerDom, 'mousedown', (event) => {
				event.stopPropagation();
			}));
			this._register(dom.addDisposableListener(innerDom, 'contextmenu', (event) => {
				event.stopPropagation();
			}));
		}
	}

	/**
	 * Trigger a re-search. Called when the console output changes while the
	 * find widget is visible.
	 */
	public refreshSearch(): void {
		if (this.isVisible() && this.inputValue.length > 0) {
			this._performSearch();
			this.updateResultCount();
		}
	}

	// --- SimpleFindWidget abstract method implementations ---

	find(previous: boolean): void {
		if (this._matches.length === 0) {
			return;
		}

		if (previous) {
			this._currentMatchIndex = this._currentMatchIndex <= 0
				? this._matches.length - 1
				: this._currentMatchIndex - 1;
		} else {
			this._currentMatchIndex = this._currentMatchIndex >= this._matches.length - 1
				? 0
				: this._currentMatchIndex + 1;
		}

		this._updateActiveHighlight();
		this._scrollToActiveMatch();
		this.updateResultCount();
	}

	findFirst(): void {
		if (this._matches.length === 0) {
			return;
		}
		this._currentMatchIndex = 0;
		this._updateActiveHighlight();
		this._scrollToActiveMatch();
		this.updateResultCount();
	}

	protected _onInputChanged(): boolean {
		this._performSearch();
		return this._matches.length > 0;
	}

	protected _onFocusTrackerFocus(): void {
		// No action needed; no context key depends on widget-level focus.
	}

	protected _onFocusTrackerBlur(): void {
		// No action needed; no context key depends on widget-level focus.
	}

	protected _onFindInputFocusTrackerFocus(): void {
		this._findInputFocused.set(true);
	}

	protected _onFindInputFocusTrackerBlur(): void {
		this._findInputFocused.reset();
	}

	protected async _getResultCount(): Promise<{ resultIndex: number; resultCount: number } | undefined> {
		if (this._matches.length === 0) {
			return undefined;
		}
		return {
			resultIndex: this._currentMatchIndex,
			resultCount: this._matches.length,
		};
	}

	// --- Lifecycle ---

	override reveal(initialInput?: string): void {
		const selection = dom.getActiveWindow().document.getSelection();
		const selectedText = selection && selection.type === 'Range' && !selection.toString().includes('\n')
			? selection.toString()
			: undefined;
		const input = initialInput ?? selectedText ?? this.inputValue;

		super.reveal(input);
		this._findWidgetVisible.set(true);

		if (input && input.length > 0) {
			this._performSearch();
			this.updateResultCount();
		}
	}

	override hide(): void {
		super.hide();
		this._clearHighlights();
		this._matches = [];
		this._currentMatchIndex = -1;
		this._findWidgetVisible.reset();
		this._onDidHideEmitter.fire();
	}

	override dispose(): void {
		this._clearHighlights();
		super.dispose();
	}

	// --- Search implementation ---

	/**
	 * Gets the console instance element that the widget is currently
	 * attached to (its direct parent).
	 */
	private _getSearchContainer(): HTMLElement | undefined {
		const parent = this.getDomNode().parentElement;
		return parent && parent.classList.contains('console-instance') ? parent : undefined;
	}

	/**
	 * Perform the search across all visible text in the console DOM.
	 */
	private _performSearch(): void {
		this._clearHighlights();
		this._matches = [];
		this._currentMatchIndex = -1;

		const searchString = this.inputValue;
		if (searchString.length === 0) {
			return;
		}

		// Build the search pattern.
		let pattern: RegExp;
		try {
			if (this._getRegexValue()) {
				const flags = this._getCaseSensitiveValue() ? 'g' : 'gi';
				pattern = new RegExp(searchString, flags);
			} else {
				const escaped = searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const flags = this._getCaseSensitiveValue() ? 'g' : 'gi';
				const patternStr = this._getWholeWordValue() ? `\\b${escaped}\\b` : escaped;
				pattern = new RegExp(patternStr, flags);
			}
		} catch {
			return;
		}

		const searchContainer = this._getSearchContainer();
		if (!searchContainer) {
			return;
		}

		this._searchInElement(searchContainer, pattern);

		// Start at the last (bottom-most) match so Enter navigates upward.
		if (this._matches.length > 0) {
			this._currentMatchIndex = this._matches.length - 1;
			this._applyHighlights();
			this._scrollToActiveMatch();
		}
	}

	/**
	 * Search within a container element by walking its text nodes.
	 * Text nodes are grouped by their nearest block-level ancestor (DIV)
	 * so that matches cannot span across different output lines.
	 */
	private _searchInElement(container: HTMLElement, pattern: RegExp): void {
		// Group text nodes by their nearest block-level ancestor.
		// Each group corresponds to a single rendered output line.
		const groups = this._collectTextGroups(container);

		// Search each group independently - no cross-line matching.
		for (const group of groups) {
			if (this._matches.length >= MATCHES_LIMIT) {
				break;
			}

			// Concatenate all text in this group.
			const fullText = group.nodes.map(n => n.node.textContent || '').join('');
			if (fullText.length === 0) {
				continue;
			}

			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = pattern.exec(fullText)) !== null) {
				if (match[0].length === 0) {
					pattern.lastIndex++;
					continue;
				}
				if (this._matches.length >= MATCHES_LIMIT) {
					break;
				}

				const matchStart = match.index;
				const matchEnd = matchStart + match[0].length;

				// Create a Range spanning the matched text nodes.
				const range = container.ownerDocument.createRange();
				let startSet = false;
				let endSet = false;

				for (const { node: textNode, offset } of group.nodes) {
					const nodeLength = textNode.textContent?.length || 0;
					const nodeEnd = offset + nodeLength;

					if (!startSet && matchStart >= offset && matchStart < nodeEnd) {
						range.setStart(textNode, matchStart - offset);
						startSet = true;
					}

					if (startSet && matchEnd >= offset && matchEnd <= nodeEnd) {
						range.setEnd(textNode, matchEnd - offset);
						endSet = true;
						break;
					}
				}

				if (startSet && endSet) {
					this._matches.push({ range });
				}
			}
		}
	}

	/**
	 * Collect text nodes from the container, grouped by their nearest
	 * block-level ancestor. Each group represents one visual output line.
	 */
	private _collectTextGroups(container: HTMLElement): { nodes: { node: Text; offset: number }[] }[] {
		const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		let node: Text | null;

		const groups: { nodes: { node: Text; offset: number }[] }[] = [];
		let currentBlock: Element | null = null;
		let currentGroup: { nodes: { node: Text; offset: number }[] } | null = null;
		let currentOffset = 0;

		while ((node = walker.nextNode() as Text | null)) {
			// Skip text nodes inside the find widget.
			if (this.getDomNode().contains(node)) {
				continue;
			}

			const block = this._getLineAncestor(node, container);
			if (block !== currentBlock) {
				if (currentGroup && currentGroup.nodes.length > 0) {
					groups.push(currentGroup);
				}
				currentBlock = block;
				currentGroup = { nodes: [] };
				currentOffset = 0;
			}
			if (currentGroup) {
				const text = node.textContent || '';
				currentGroup.nodes.push({ node, offset: currentOffset });
				currentOffset += text.length;
			}
		}
		if (currentGroup && currentGroup.nodes.length > 0) {
			groups.push(currentGroup);
		}

		return groups;
	}

	/**
	 * Gets the nearest block/line-level ancestor of a text node.
	 * Uses the element's tag name to avoid getComputedStyle calls.
	 */
	private _getLineAncestor(node: Node, container: HTMLElement): Element | null {
		let current = node.parentElement;
		while (current && current !== container) {
			const tag = current.tagName;
			if (tag === 'DIV' || tag === 'P' || tag === 'PRE' || tag === 'LI' ||
				tag === 'TR' || tag === 'SECTION' || tag === 'ARTICLE') {
				return current;
			}
			current = current.parentElement;
		}
		return container;
	}

	// --- Highlighting ---

	/**
	 * Apply CSS Custom Highlights for all matches and the active match.
	 */
	private _applyHighlights(): void {
		if (!hasHighlightsApi() || this._matches.length === 0) {
			return;
		}

		const allRanges = this._matches.map(m => m.range);
		const allHighlight = new Highlight(...allRanges);
		allHighlight.priority = 1;
		CSS.highlights.set(HIGHLIGHT_ALL, allHighlight);

		this._updateActiveHighlight();
	}

	/**
	 * Update just the active match highlight.
	 */
	private _updateActiveHighlight(): void {
		if (!hasHighlightsApi()) {
			return;
		}

		if (this._currentMatchIndex >= 0 && this._currentMatchIndex < this._matches.length) {
			const activeHighlight = new Highlight(this._matches[this._currentMatchIndex].range);
			activeHighlight.priority = 2;
			CSS.highlights.set(HIGHLIGHT_ACTIVE, activeHighlight);
		} else {
			CSS.highlights.delete(HIGHLIGHT_ACTIVE);
		}
	}

	/**
	 * Clear all CSS Custom Highlights.
	 */
	private _clearHighlights(): void {
		if (hasHighlightsApi()) {
			CSS.highlights.delete(HIGHLIGHT_ALL);
			CSS.highlights.delete(HIGHLIGHT_ACTIVE);
		}
	}

	/**
	 * Scroll the active match into view within the console's scroll container.
	 */
	private _scrollToActiveMatch(): void {
		if (this._currentMatchIndex < 0 || this._currentMatchIndex >= this._matches.length) {
			return;
		}

		const range = this._matches[this._currentMatchIndex].range;
		const searchContainer = this._getSearchContainer();
		if (!searchContainer) {
			return;
		}

		const rangeRect = range.getBoundingClientRect();
		const containerRect = searchContainer.getBoundingClientRect();

		if (rangeRect.top < containerRect.top || rangeRect.bottom > containerRect.bottom) {
			const scrollTarget = searchContainer.scrollTop +
				(rangeRect.top - containerRect.top) -
				(containerRect.height / 2);
			searchContainer.scrollTo({
				top: scrollTarget,
				behavior: 'auto',
			});
		}
	}
}

/**
 * ConsoleFindWidgetFactory - creates PositronConsoleFindWidget instances.
 * Registered as a singleton so the service layer can create find widgets
 * without depending on the concrete implementation.
 */
export class ConsoleFindWidgetFactory implements IConsoleFindWidgetFactory {
	readonly _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) { }

	createFindWidget() {
		return this._instantiationService.createInstance(PositronConsoleFindWidget);
	}
}
