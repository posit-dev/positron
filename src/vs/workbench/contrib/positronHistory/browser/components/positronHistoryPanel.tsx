/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { Delayer } from '../../../../../base/common/async.js';
import { IExecutionHistoryService, IInputHistoryEntry } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { isCodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { CodeAttributionSource } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarFilter } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { IPositronModalDialogsService } from '../../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { LanguageFilterMenuButton } from './languageFilterMenuButton.js';
import { HistoryEntry, MAX_COLLAPSED_LINES } from './historyEntry.js';
import { HistorySeparator } from './historySeparator.js';
import { getSectionLabel, isSameSection } from './historyGrouping.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import * as DOM from '../../../../../base/browser/dom.js';
import './positronHistoryPanel.css';

// Localized strings
const positronHistoryToConsole = localize('positronHistoryToConsole', "To Console");
const positronHistoryToConsoleTooltip = localize('positronHistoryToConsoleTooltip', "Send the selected code to the console for execution");
const positronHistoryToSource = localize('positronHistoryToSource', "To Source");
const positronHistoryToSourceTooltip = localize('positronHistoryToSourceTooltip', "Insert the selected code at the cursor position in the source editor");
const positronHistoryCopyTooltip = localize('positronHistoryCopyTooltip', "Copy the selected code to the clipboard");
const positronHistoryDeleteTooltip = localize('positronHistoryDeleteTooltip', "Delete the selected history entry");
const positronHistorySearch = localize('positronHistorySearch', "Search");
const positronHistoryClearSearch = localize('positronHistoryClearSearch', "Clear Search");
const positronHistoryNoMatches = (searchText: string) => localize('positronHistoryNoMatches', "No history entries matching '{0}' were found.", searchText);
const positronHistoryClearAll = localize('positronHistoryClearAll', "Clear All");
const positronHistoryClearAllTooltip = localize('positronHistoryClearAllTooltip', "Clear all input history for the selected language");
const positronHistoryClearAllConfirmTitle = localize('positronHistoryClearAllConfirmTitle', "Clear All History");
const positronHistoryClearAllConfirmMessage = (language: string) => localize('positronHistoryClearAllConfirmMessage', "Are you sure you want to clear all input history for {0}? This action cannot be undone.", language);
const positronHistoryLoading = localize('positronHistoryLoading', "Loading...");

/**
 * Props for the PositronHistoryPanel component
 */
interface PositronHistoryPanelProps {
	reactComponentContainer: IReactComponentContainer;
	executionHistoryService: IExecutionHistoryService;
	runtimeSessionService: IRuntimeSessionService;
	runtimeStartupService: IRuntimeStartupService;
	instantiationService: IInstantiationService;
	positronModalDialogsService: IPositronModalDialogsService;
	fontInfo: FontInfo;
}

/**
 * Type for a history entry item in the list
 */
export type HistoryEntryItem = {
	type: 'entry';
	entry: IInputHistoryEntry;
	lines: number; // Total number of lines in the entry input
	originalInput: string; // The original full code input
	trimmedInput: string; // The trimmed code input
	visibleLines: number; // Number of lines shown when collapsed
	originalIndex: number; // Index in the original entries array
};

/**
 * Type for a separator item in the list
 */
export type HistorySeparatorItem = {
	type: 'separator';
	label: string;
};

/**
 * Type for list items - can be either a history entry or a separator
 */
export type ListItem = HistoryEntryItem | HistorySeparatorItem;

/**
 * The default height for a history entry row (3 lines of code)
 * With minimal padding and tight line height, ~40px should be enough for 3 lines
 */
const DEFAULT_ROW_HEIGHT = 40;

/**
 * The height of a separator row
 */
const SEPARATOR_HEIGHT = 26;

/**
 * PositronHistoryPanel component - displays execution history with virtualization
 */
export const PositronHistoryPanel = (props: PositronHistoryPanelProps) => {
	const {
		reactComponentContainer,
		executionHistoryService,
		runtimeSessionService,
		runtimeStartupService,
		instantiationService,
		positronModalDialogsService
	} = props;

	// State
	const [listItems, setListItems] = useState<ListItem[]>([]);
	const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
	const [anchorIndex, setAnchorIndex] = useState<number>(-1);
	const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(undefined);
	const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);
	const [stickyHeaderLabel, setStickyHeaderLabel] = useState<string | null>(null);
	const [stickyHeaderSeparatorIndex, setStickyHeaderSeparatorIndex] = useState<number>(-1);
	const [searchText, setSearchText] = useState<string>('');
	const [debouncedSearchText, setDebouncedSearchText] = useState<string>('');

	// Refs
	const listRef = useRef<List>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const searchDelayerRef = useRef<Delayer<void>>(new Delayer<void>(300));
	const filterRef = useRef<any>(null);
	const hasInitializedSizeRef = useRef<boolean>(false);
	const selectedIndicesRef = useRef<Set<number>>(selectedIndices);
	const anchorIndexRef = useRef<number>(anchorIndex);
	const listItemsRef = useRef<ListItem[]>(listItems);
	const debouncedSearchTextRef = useRef<string>(debouncedSearchText);
	const currentLanguageRef = useRef<string | undefined>(currentLanguage);
	const rangeAnchorRef = useRef<number>(-1);
	const lastValidWidthRef = useRef<number>(0);
	const lastValidHeightRef = useRef<number>(0);
	const wasVisibleRef = useRef<boolean>(true);
	const pendingFocusIndexRef = useRef<number>(-1);
	const isAtBottomRef = useRef<boolean>(true);
	const prevListItemsLengthRef = useRef<number>(0);
	const scrollOffsetPerLanguageRef = useRef<Map<string, number>>(new Map());
	const currentScrollOffsetRef = useRef<number>(0);
	const pendingScrollRestoreRef = useRef<string | null>(null);

	// Wrappers that update both state and refs synchronously,
	// so event handlers that fire before the next render read current values.
	const updateSelectedIndices = (value: Set<number>) => {
		selectedIndicesRef.current = value;
		setSelectedIndices(value);
	};
	const updateAnchorIndex = (value: number) => {
		anchorIndexRef.current = value;
		setAnchorIndex(value);
	};

	// Track previous anchor to reset row heights for both old and new anchor
	const prevAnchorIndexRef = useRef<number>(-1);

	/**
	 * Reset row heights when anchor changes.
	 * Only the anchor entry expands to show all lines; other selected entries stay collapsed.
	 */
	useEffect(() => {
		if (listRef.current) {
			const prevIndex = prevAnchorIndexRef.current;
			// Reset from the lower index to recalculate heights for both old and new anchor
			const resetFromIndex = Math.min(
				prevIndex >= 0 ? prevIndex : anchorIndex,
				anchorIndex >= 0 ? anchorIndex : prevIndex
			);
			if (resetFromIndex >= 0) {
				listRef.current.resetAfterIndex(resetFromIndex);
			}
		}
		prevAnchorIndexRef.current = anchorIndex;
	}, [anchorIndex]);

	/**
	 * Restore focus to the anchor entry after selection changes cause a re-render.
	 * react-window may recreate DOM elements during re-render, causing focus loss.
	 */
	useEffect(() => {
		if (anchorIndex >= 0 && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			// Use requestAnimationFrame to ensure DOM has been updated after re-render
			targetWindow.requestAnimationFrame(() => {
				const container = containerRef.current;
				if (container) {
					const selectedEntry = container.querySelector('.history-entry.selected, .history-entry.selected-unfocused') as HTMLElement | null;
					if (selectedEntry && targetWindow.document.activeElement !== selectedEntry) {
						selectedEntry.focus();
					}
				}
			});
		}
	}, [anchorIndex, selectedIndices]);

	/**
	 * Reset all row heights when list items change (e.g., language change, search filter change).
	 * This is needed because all entries are replaced with new ones that have different heights.
	 *
	 * Also restore the saved scroll position when switching languages. The scroll
	 * restore is done in a requestAnimationFrame so it runs after react-window has
	 * processed the height reset and re-rendered.
	 */
	useEffect(() => {
		if (listRef.current) {
			listRef.current.resetAfterIndex(0);
		}

		const pendingLang = pendingScrollRestoreRef.current;
		if (pendingLang && listRef.current && listItems.length > 0 && containerRef.current) {
			pendingScrollRestoreRef.current = null;
			const savedOffset = scrollOffsetPerLanguageRef.current.get(pendingLang);
			const targetWindow = DOM.getWindow(containerRef.current);
			targetWindow.requestAnimationFrame(() => {
				if (listRef.current) {
					if (savedOffset !== undefined) {
						listRef.current.scrollTo(savedOffset);
					} else {
						// No saved position for this language; scroll to the bottom
						listRef.current.scrollToItem(listItemsRef.current.length - 1, 'end');
					}
				}
			});
		}
	}, [listItems]);

	useEffect(() => {
		listItemsRef.current = listItems;
	}, [listItems]);

	/**
	 * Focus the pending item after deletion causes a re-render.
	 * This effect runs when listItems changes and checks if there's a pending focus index.
	 */
	useEffect(() => {
		if (pendingFocusIndexRef.current >= 0 && containerRef.current) {
			pendingFocusIndexRef.current = -1; // Clear the pending focus

			const targetWindow = DOM.getWindow(containerRef.current);
			// Use requestAnimationFrame to ensure DOM has been updated after re-render
			targetWindow.requestAnimationFrame(() => {
				const container = containerRef.current;
				if (container) {
					const selectedEntry = container.querySelector('.history-entry.selected, .history-entry.selected-unfocused') as HTMLElement | null;
					if (selectedEntry) {
						selectedEntry.focus();
					}
				}
			});
		}
	}, [listItems]);

	useEffect(() => {
		debouncedSearchTextRef.current = debouncedSearchText;
	}, [debouncedSearchText]);

	useEffect(() => {
		currentLanguageRef.current = currentLanguage;
	}, [currentLanguage]);

	/**
	 * Custom inner element for the List that enables sticky positioning
	 */
	const StickyInnerElement = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>((props, ref) => (
		<div ref={ref} {...props} style={{ ...props.style, position: 'relative' }} />
	));

	/**
	 * Get the height of a row.
	 *
	 * It's important that we compute this accurately, since react-window relies
	 * on these heights for virtualization. Incorrectly computed heights will
	 * lead to overlapping items or excessive blank space.
	 *
	 * @param index The index of the row
	 */
	const getRowHeight = (index: number): number => {
		const item = listItems[index];
		if (!item) {
			return DEFAULT_ROW_HEIGHT;
		}
		if (item.type === 'separator') {
			return SEPARATOR_HEIGHT;
		}

		// Only the anchor entry expands to show all lines; other selected entries stay collapsed
		const linesToShow = (index === anchorIndex) ? item.lines : item.visibleLines;

		// Compute the height based on font line height + padding
		return linesToShow * (props.fontInfo.lineHeight) + 9;
	};

	/**
	 * Compute the total content height of all items in the list.
	 * Used for initialScrollOffset and for detecting whether we're scrolled to the bottom.
	 */
	const getTotalContentHeight = useCallback((items: ListItem[], anchor: number): number => {
		let total = 0;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item) {
				total += DEFAULT_ROW_HEIGHT;
			} else if (item.type === 'separator') {
				total += SEPARATOR_HEIGHT;
			} else {
				const linesToShow = (i === anchor) ? item.lines : item.visibleLines;
				total += linesToShow * (props.fontInfo.lineHeight) + 9;
			}
		}
		return total;
	}, [props.fontInfo.lineHeight]);

	/**
	 * Create list items with separators from entries
	 * Memoized to prevent unnecessary re-creation during renders
	 */
	const createListItems = useMemo(() => (entries: IInputHistoryEntry[]): ListItem[] => {
		const items: ListItem[] = [];
		const currentDate = new Date();

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const prevEntry = i > 0 ? entries[i - 1] : null;

			// Add separator if this is the first entry or if section changes
			if (!prevEntry || !isSameSection(entry.when, prevEntry.when, currentDate)) {
				const label = getSectionLabel(entry.when, currentDate);
				items.push({ type: 'separator', label });
			}

			const trimmedInput = entry.input.trimEnd();

			// Compute the number of lines in the entry
			const lines = trimmedInput.split('\n').length;
			const visibleLines = lines > MAX_COLLAPSED_LINES ?
				MAX_COLLAPSED_LINES + 1 : lines; // Show max 4 lines + ellipsis line when collapsed

			// Add the entry
			items.push({
				type: 'entry',
				entry,
				originalInput: entry.input,
				trimmedInput,
				lines,
				visibleLines,
				originalIndex: i
			});
		}

		return items;
	}, []);

	/**
	 * Filter entries based on search text
	 */
	const filterEntries = (entries: IInputHistoryEntry[], search: string): IInputHistoryEntry[] => {
		if (!search) {
			return entries;
		}

		const searchLower = search.toLowerCase();
		return entries.filter(entry => entry.input.toLowerCase().includes(searchLower));
	};

	/**
	 * Get the display name for a language ID (e.g., "python" -> "Python")
	 */
	const getLanguageDisplayName = (languageId: string): string => {
		return languageId.charAt(0).toUpperCase() + languageId.slice(1);
	};

	/**
	 * Get sorted list of selected entry indices from current state or refs.
	 * When called from an action bar button, index will be a KeyboardModifiers object, so we
	 * always fall through to using the selectedIndices set.
	 */
	const getSelectedEntryIndices = (index?: number): number[] => {
		if (typeof index === 'number') {
			return [index];
		}
		return Array.from(selectedIndicesRef.current).sort((a, b) => a - b);
	};

	/**
	 * Handle "Copy" - copies selected code to clipboard
	 */
	const handleCopy = (index?: number) => {
		const indices = getSelectedEntryIndices(index);
		const items = listItemsRef.current;
		if (indices.length === 0) {
			return;
		}

		const texts: string[] = [];
		for (const idx of indices) {
			if (idx < 0 || idx >= items.length) {
				continue;
			}
			const item = items[idx];
			if (item.type === 'entry') {
				texts.push(item.entry.input);
			}
		}

		if (texts.length === 0) {
			return;
		}

		const clipboardService = instantiationService.invokeFunction(accessor =>
			accessor.get(IClipboardService)
		);

		clipboardService.writeText(texts.join('\n'));
	};

	/**
	 * Handle "Delete" - deletes all selected history entries
	 */
	const handleDelete = (index?: number) => {
		const indices = getSelectedEntryIndices(index);
		const items = listItemsRef.current;
		const language = currentLanguageRef.current;
		if (indices.length === 0 || !language) {
			return;
		}

		// Collect entries to delete (in sorted order)
		const entriesToDelete: { when: number; input: string }[] = [];
		for (const idx of indices) {
			if (idx < 0 || idx >= items.length) {
				continue;
			}
			const item = items[idx];
			if (item.type === 'entry') {
				entriesToDelete.push({ when: item.entry.when, input: item.entry.input });
			}
		}

		if (entriesToDelete.length === 0) {
			return;
		}

		// Find the next selectable item after the last deleted index
		const lastDeletedIdx = indices[indices.length - 1];
		const deletedSet = new Set(indices);

		// Look forward from the last deleted item for a survivor
		let newSelectedIndex = -1;
		for (let i = lastDeletedIdx + 1; i < items.length; i++) {
			if (!deletedSet.has(i) && items[i].type === 'entry') {
				newSelectedIndex = i;
				break;
			}
		}
		// If nothing forward, look backward from the first deleted item
		if (newSelectedIndex === -1) {
			const firstDeletedIdx = indices[0];
			for (let i = firstDeletedIdx - 1; i >= 0; i--) {
				if (!deletedSet.has(i) && items[i].type === 'entry') {
					newSelectedIndex = i;
					break;
				}
			}
		}

		// Delete all entries from the service
		for (const entry of entriesToDelete) {
			executionHistoryService.deleteInputEntry(language, entry.when, entry.input);
		}

		// Calculate the final index after deletions.
		// Count how many deleted indices are before newSelectedIndex.
		let finalIndex = newSelectedIndex;
		if (newSelectedIndex >= 0) {
			let shiftCount = 0;
			for (const idx of indices) {
				if (idx < newSelectedIndex) {
					shiftCount++;
				}
			}
			finalIndex = newSelectedIndex - shiftCount;
		}

		// Set the pending focus index so that after re-render, we focus the new item
		pendingFocusIndexRef.current = finalIndex;

		// Update selection before reloading
		rangeAnchorRef.current = -1;
		if (finalIndex >= 0) {
			updateSelectedIndices(new Set([finalIndex]));
			updateAnchorIndex(finalIndex);
		} else {
			updateSelectedIndices(new Set());
			updateAnchorIndex(-1);
		}

		// Reload the history to refresh the view
		loadHistory();
	};

	/**
	 * Load history entries for the current language
	 */
	const loadHistory = useCallback(() => {
		const language = currentLanguageRef.current;
		if (language) {
			const historyEntries = executionHistoryService.getInputEntries(language);

			// Filter out consecutive duplicates and empty entries
			const filteredEntries = historyEntries.filter((entry) => {
				// Don't include empty entries
				if (!entry.input.trim()) {
					return false;
				}
				// Don't include debug entries
				if (entry.debug && entry.debug !== 'inactive') {
					return false;
				}
				return true;
			}).filter((entry, index, arr) => {
				// Filter out consecutive duplicates
				if (index === 0) {
					return true;
				}
				return entry.input !== arr[index - 1].input;
			});

			// Apply search filter
			const searchFilteredEntries = filterEntries(filteredEntries, debouncedSearchText);

			// Create list items with separators
			const items = createListItems(searchFilteredEntries);
			setListItems(items);
		}
	}, [executionHistoryService, debouncedSearchText, createListItems]);

	/**
	 * Discover all available languages from history
	 */
	const discoverLanguages = useCallback(() => {
		// Get all languages that have input history
		const languages = executionHistoryService.getAvailableLanguages();

		// Also add languages from active sessions (even if they don't have history yet)
		const sessions = runtimeSessionService.activeSessions;
		const languageSet = new Set<string>(languages);

		sessions.forEach(session => {
			const languageId = session.runtimeMetadata.languageId;
			languageSet.add(languageId);
		});

		setAvailableLanguages(Array.from(languageSet));
	}, [executionHistoryService, runtimeSessionService]);

	/**
	 * Save the current scroll position for the current language before switching away.
	 */
	const saveScrollPosition = () => {
		const lang = currentLanguageRef.current;
		if (lang) {
			scrollOffsetPerLanguageRef.current.set(lang, currentScrollOffsetRef.current);
		}
	};

	/**
	 * Handle language selection from dropdown
	 */
	const handleSelectLanguage = (languageId: string) => {
		saveScrollPosition();
		pendingScrollRestoreRef.current = languageId;
		setCurrentLanguage(languageId);
	};

	/**
	 * Handle search text change with debouncing
	 */
	const handleSearchTextChange = (text: string) => {
		setSearchText(text);
		searchDelayerRef.current.trigger(() => {
			setDebouncedSearchText(text);
			return Promise.resolve();
		});
	};

	/**
	 * Clear search
	 */
	const handleClearSearch = () => {
		setSearchText('');
		setDebouncedSearchText('');
		if (filterRef.current) {
			filterRef.current.setFilterText('');
		}
	};

	/**
	 * Handle clear all - clears search if active, otherwise clears all history for current language
	 */
	const handleClearAll = async () => {
		// If there's an active search, just clear the search
		if (searchText) {
			handleClearSearch();
			return;
		}

		// Otherwise, clear all history for the current language
		if (!currentLanguage) {
			return;
		}

		// Show confirmation dialog with the display name (e.g., "Python" instead of "python")
		const languageDisplayName = getLanguageDisplayName(currentLanguage);
		const confirmed = await positronModalDialogsService.showSimpleModalDialogPrompt(
			positronHistoryClearAllConfirmTitle,
			positronHistoryClearAllConfirmMessage(languageDisplayName),
			positronHistoryClearAll,
			localize('cancel', "Cancel")
		);

		if (confirmed) {
			executionHistoryService.clearInputEntries(currentLanguage);
			// Reset selection since all entries will be gone
			rangeAnchorRef.current = -1;
			updateSelectedIndices(new Set());
			updateAnchorIndex(-1);
			// Reload the history to update the UI
			loadHistory();
		}
	};

	/**
	 * Get the height of the sticky header if it is currently visible.
	 * Measures from the DOM so the value is correct even inside stale closures.
	 */
	const getStickyHeaderHeight = (): number => {
		const header = containerRef.current?.querySelector('.history-sticky-header') as HTMLElement | null;
		return header ? header.offsetHeight : 0;
	};

	/**
	 * Check if an item at the given index is fully visible in the viewport,
	 * accounting for the sticky header that may overlay the top of the list.
	 */
	const isItemFullyVisible = (index: number): boolean => {
		if (!listRef.current) {
			return false;
		}

		const items = listItemsRef.current;
		const anchor = anchorIndexRef.current;

		// Calculate the item's position from accumulated row heights
		let itemTop = 0;
		for (let i = 0; i < index; i++) {
			itemTop += computeRowHeight(i, items, anchor);
		}
		const itemHeight = computeRowHeight(index, items, anchor);
		const itemBottom = itemTop + itemHeight;

		const scrollTop = currentScrollOffsetRef.current;
		const viewportHeight = Math.max(lastValidHeightRef.current, 1) - 30;
		const headerOffset = getStickyHeaderHeight();

		// Check if the item is fully within the visible area (below the sticky header)
		return itemTop >= scrollTop + headerOffset && itemBottom <= scrollTop + viewportHeight;
	};

	/**
	 * Compute the height of a single row using explicit items/anchor values.
	 * This avoids closing over React state so it works from stale closures.
	 */
	const computeRowHeight = (index: number, items: ListItem[], anchor: number): number => {
		const item = items[index];
		if (!item) {
			return DEFAULT_ROW_HEIGHT;
		}
		if (item.type === 'separator') {
			return SEPARATOR_HEIGHT;
		}
		const linesToShow = (index === anchor) ? item.lines : item.visibleLines;
		return linesToShow * (props.fontInfo.lineHeight) + 9;
	};

	/**
	 * Scroll an item into view, accounting for the sticky header overlay.
	 * Unlike react-window's scrollToItem('smart'), this ensures items scrolled
	 * upward are not hidden behind the sticky header.
	 *
	 * Uses refs instead of state so this works correctly from stale closures
	 * (e.g. the handleKeyDown useCallback with empty deps).
	 */
	const scrollItemIntoView = (index: number) => {
		if (!listRef.current) {
			return;
		}

		// Read current values from refs to avoid stale closure issues
		const items = listItemsRef.current;
		const anchor = anchorIndexRef.current;

		// Calculate the item's position from accumulated row heights
		let itemTop = 0;
		for (let i = 0; i < index; i++) {
			itemTop += computeRowHeight(i, items, anchor);
		}
		const itemHeight = computeRowHeight(index, items, anchor);
		const itemBottom = itemTop + itemHeight;

		// Use the ref-tracked scroll offset (updated every onScroll) so this
		// works even inside stale closures.
		const scrollTop = currentScrollOffsetRef.current;
		const viewportHeight = Math.max(lastValidHeightRef.current, 1) - 30;
		const headerOffset = getStickyHeaderHeight();

		if (itemTop < scrollTop + headerOffset) {
			// Item is above the visible area (or hidden behind sticky header) - scroll up
			listRef.current.scrollTo(Math.max(0, itemTop - headerOffset));
		} else if (itemBottom > scrollTop + viewportHeight) {
			// Item is below the visible area - scroll down
			listRef.current.scrollTo(itemBottom - viewportHeight);
		}
		// Otherwise item is fully visible, no scroll needed
	};

	/**
	 * Helper to set selection to a single index (convenience wrapper).
	 */
	const selectSingle = (index: number) => {
		// Skip if already single-selected on this index to avoid unnecessary re-renders.
		// This is important for double-click: creating a new Set triggers a re-render
		// which causes react-window to recreate the DOM element, losing the dblclick event.
		if (selectedIndicesRef.current.size === 1 && selectedIndicesRef.current.has(index) && anchorIndexRef.current === index) {
			return;
		}
		rangeAnchorRef.current = -1;
		updateSelectedIndices(new Set([index]));
		updateAnchorIndex(index);
	};

	/**
	 * Handle selection change with multi-select support.
	 * - Plain click: single-select
	 * - Cmd/Ctrl+Click: toggle in/out of selection
	 * - Shift+Click: range select from anchor to clicked index
	 */
	const handleSelect = (index: number, e?: React.MouseEvent) => {
		// Skip separators
		const item = listItems[index];
		if (!item || item.type === 'separator') {
			return;
		}

		if (e && e.shiftKey && anchorIndex >= 0) {
			// Shift+Click: range select from range anchor (or anchor) to clicked index.
			// Use rangeAnchorRef if already in a range operation, otherwise use anchorIndex.
			const fixedAnchor = rangeAnchorRef.current >= 0 ? rangeAnchorRef.current : anchorIndex;
			if (rangeAnchorRef.current < 0) {
				rangeAnchorRef.current = anchorIndex;
			}
			const start = Math.min(fixedAnchor, index);
			const end = Math.max(fixedAnchor, index);
			const newSet = new Set<number>();
			for (let i = start; i <= end; i++) {
				const listItem = listItems[i];
				if (listItem && listItem.type === 'entry') {
					newSet.add(i);
				}
			}
			updateSelectedIndices(newSet);
			// Keep original anchor, don't change it
		} else if (e && (isMacintosh ? e.metaKey : e.ctrlKey)) {
			// Cmd/Ctrl+Click: toggle this index
			rangeAnchorRef.current = -1;
			const newSet = new Set(selectedIndices);
			if (newSet.has(index)) {
				newSet.delete(index);
				// If we removed the anchor, pick first remaining or -1
				if (index === anchorIndex) {
					const remaining = Array.from(newSet).sort((a, b) => a - b);
					updateAnchorIndex(remaining.length > 0 ? remaining[0] : -1);
				}
			} else {
				newSet.add(index);
				updateAnchorIndex(index);
			}
			updateSelectedIndices(newSet);
		} else {
			// Plain click: single-select
			selectSingle(index);
		}

		// Only scroll if the item is not already fully visible
		if (!isItemFullyVisible(index)) {
			scrollItemIntoView(index);
		}
	};

	/**
	 * Handle scroll event to update auto-scroll state and sticky header
	 */
	const handleScroll = ({ scrollOffset, scrollUpdateWasRequested }: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => {

		// Track current scroll offset for per-language save/restore
		currentScrollOffsetRef.current = scrollOffset;

		// Track whether we're scrolled to the bottom (within a small threshold)
		const viewportHeight = Math.max(lastValidHeightRef.current, height) - 30;
		const totalHeight = getTotalContentHeight(listItems, anchorIndex);
		const maxScroll = Math.max(0, totalHeight - viewportHeight);
		isAtBottomRef.current = scrollOffset >= maxScroll - 5;

		// Find which section is currently at the top of the viewport
		let currentOffset = 0;
		let currentSectionLabel: string | null = null;
		let currentSeparatorIndex = -1;

		for (let i = 0; i < listItems.length; i++) {
			const item = listItems[i];
			const itemHeight = getRowHeight(i);

			if (item.type === 'separator') {
				// If we haven't scrolled past this separator yet, it's the current section
				if (currentOffset + itemHeight > scrollOffset) {
					currentSectionLabel = item.label;
					currentSeparatorIndex = i;
					break;
				}
				// Update the current section as we pass each separator
				currentSectionLabel = item.label;
				currentSeparatorIndex = i;
			}

			currentOffset += itemHeight;

			// If we've gone past the scroll position, use the last separator we saw
			if (currentOffset > scrollOffset) {
				break;
			}
		}

		setStickyHeaderLabel(currentSectionLabel);
		setStickyHeaderSeparatorIndex(currentSeparatorIndex);
	};

	/**
	 * Find the next selectable index (skipping separators) in the given direction
	 */
	const findNextSelectableIndex = (startIndex: number, direction: 1 | -1, items: ListItem[]): number => {
		let index = startIndex;
		while (index >= 0 && index < items.length) {
			const item = items[index];
			if (item && item.type === 'entry') {
				return index;
			}
			index += direction;
		}
		// If we didn't find anything, stay at current position or find first/last valid item
		if (direction > 0) {
			// Search from beginning
			for (let i = 0; i < items.length; i++) {
				if (items[i].type === 'entry') {
					return i;
				}
			}
		} else {
			// Search from end
			for (let i = items.length - 1; i >= 0; i--) {
				if (items[i].type === 'entry') {
					return i;
				}
			}
		}
		// No selectable items found
		return -1;
	};

	/**
	 * Handle click on the sticky header - scrolls to show the separator and selects the first entry after it
	 */
	const handleStickyHeaderClick = () => {
		if (stickyHeaderSeparatorIndex < 0 || !listRef.current || !containerRef.current) {
			return;
		}

		// Scroll to the separator so it's visible at the top
		listRef.current.scrollToItem(stickyHeaderSeparatorIndex, 'start');

		// Select the first entry after this separator
		const nextEntryIndex = findNextSelectableIndex(stickyHeaderSeparatorIndex + 1, 1, listItems);
		if (nextEntryIndex < 0) {
			return;
		}

		// Use double requestAnimationFrame to ensure scroll and DOM update complete before focusing
		const targetWindow = DOM.getWindow(containerRef.current);
		targetWindow.requestAnimationFrame(() => {
			targetWindow.requestAnimationFrame(() => {
				selectSingle(nextEntryIndex);
				// Focus the entry after selection state updates
				const container = containerRef.current;
				if (container) {
					const selectedEntry = container.querySelector('.history-entry.selected, .history-entry.selected-unfocused') as HTMLElement | null;
					if (selectedEntry) {
						selectedEntry.focus();
					}
				}
			});
		});
	};

	/**
	 * Handle keyboard navigation in the history list
	 */
	/**
	 * Handle "To Console" button - sends all selected code to console
	 */
	const handleToConsole = (index?: number) => {
		const indices = getSelectedEntryIndices(index);
		const items = listItemsRef.current;
		const language = currentLanguageRef.current;
		if (indices.length === 0 || !language) {
			return;
		}

		const consoleService = instantiationService.invokeFunction(accessor =>
			accessor.get(IPositronConsoleService)
		);

		for (const idx of indices) {
			if (idx < 0 || idx >= items.length) {
				continue;
			}
			const item = items[idx];
			if (item.type === 'entry') {
				consoleService.executeCode(
					language,
					undefined, // session ID - use any available session
					item.entry.input,
					{ source: CodeAttributionSource.Interactive }, // attribution
					true, // focus the console
					undefined, // allow incomplete
					undefined, // mode
					undefined, // error behavior
					undefined  // execution ID
				);
			}
		}
	};

	/**
	 * Handle "To Source" button - inserts all selected code at cursor position or opens new untitled buffer
	 */
	const handleToSource = (index?: number) => {
		const indices = getSelectedEntryIndices(index);
		const items = listItemsRef.current;
		if (indices.length === 0) {
			return;
		}

		// Collect all selected entry inputs
		const texts: string[] = [];
		for (const idx of indices) {
			if (idx < 0 || idx >= items.length) {
				continue;
			}
			const item = items[idx];
			if (item.type === 'entry') {
				texts.push(item.entry.input);
			}
		}

		if (texts.length === 0) {
			return;
		}

		const combinedText = texts.join('\n');
		const editorService = instantiationService.invokeFunction(accessor =>
			accessor.get(IEditorService)
		);

		const editor = editorService.activeTextEditorControl;
		if (!editor || !isCodeEditor(editor)) {
			// No active editor - open a new untitled buffer with the code
			editorService.openEditor({
				contents: combinedText,
				languageId: currentLanguage,
				resource: undefined
			});
			return;
		}

		const position = editor.getPosition();
		if (!position) {
			return;
		}

		// Insert the code at the cursor position with a trailing newline
		editor.executeEdits('positron-history', [{
			range: {
				startLineNumber: position.lineNumber,
				startColumn: position.column,
				endLineNumber: position.lineNumber,
				endColumn: position.column
			},
			text: combinedText + '\n'
		}]);
	};

	/**
	 * Initialize - set up event listeners
	 */
	useEffect(() => {
		const disposables = new DisposableStore();

		// Listen for size changes
		disposables.add(
			reactComponentContainer.onSizeChanged(size => {
				lastValidWidthRef.current = size.width;
				lastValidHeightRef.current = size.height;
				setWidth(size.width);
				setHeight(size.height);
				hasInitializedSizeRef.current = true;
			})
		);
		// Listen for foreground session changes
		disposables.add(
			runtimeSessionService.onDidChangeForegroundSession(session => {
				if (session) {
					const languageId = session.runtimeMetadata.languageId;
					saveScrollPosition();
					pendingScrollRestoreRef.current = languageId;
					setCurrentLanguage(languageId);
				}
				// Rediscover languages when foreground session changes
				discoverLanguages();
			})
		);

		// Initialize with the language that will be restored as the foreground session
		runtimeStartupService.getRestoredSessions().then(restoredSessions => {
			if (restoredSessions.length > 0) {
				// The first restored session will become the foreground session
				const foregroundSession = restoredSessions[0];
				setCurrentLanguage(foregroundSession.runtimeMetadata.languageId);
			} else {
				// No sessions are being restored, check for an existing foreground session
				const foregroundSession = runtimeSessionService.foregroundSession;
				if (foregroundSession) {
					setCurrentLanguage(foregroundSession.runtimeMetadata.languageId);
				} else {
					// No foreground session, but we may have history. Set to the first available language.
					const languages = executionHistoryService.getAvailableLanguages();
					if (languages.length > 0) {
						setCurrentLanguage(languages[0]);
					}
				}
			}
		});

		// Initial discovery of languages
		discoverLanguages();

		// Initial size - set immediately if valid to avoid empty render
		const initialWidth = reactComponentContainer.width;
		const initialHeight = reactComponentContainer.height;
		if (initialWidth > 0 && initialHeight > 0) {
			lastValidWidthRef.current = initialWidth;
			lastValidHeightRef.current = initialHeight;
			setWidth(initialWidth);
			setHeight(initialHeight);
			hasInitializedSizeRef.current = true;
		}

		// Add focus/blur listeners to the container to track focus state
		const container = containerRef.current;

		// Set up IntersectionObserver to detect when the panel becomes visible
		// This fixes the issue where the list is empty until scrolled when switching tabs
		if (container) {
			const targetWindow = DOM.getWindow(container);
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting && !wasVisibleRef.current) {
							// Panel just became visible - force List to recalculate and re-render
							// Use requestAnimationFrame to ensure the panel is fully laid out
							targetWindow.requestAnimationFrame(() => {
								if (listRef.current) {
									// Reset from index 0 to force complete re-render
									listRef.current.resetAfterIndex(0);
								}
							});
							wasVisibleRef.current = true;
						} else if (!entry.isIntersecting) {
							wasVisibleRef.current = false;
						}
					}
				},
				{ threshold: 0.01 } // Trigger when even 1% is visible
			);
			observer.observe(container);
			disposables.add({
				dispose: () => observer.disconnect()
			});
		}

		return () => {
			disposables.dispose();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * Handle keyboard navigation in the history list.
	 * This is used both by the container's keydown listener and by HistoryEntry components.
	 */
	const handleKeyDown = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
		const currentListItems = listItemsRef.current;
		const currentAnchor = anchorIndexRef.current;
		const currentSelected = selectedIndicesRef.current;
		const currentSearchText = debouncedSearchTextRef.current;

		if (currentListItems.length === 0) {
			return;
		}

		// Immediately prevent default for navigation keys to stop browser scroll behavior
		// This must happen before any async processing
		const navigationKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
		if (navigationKeys.includes(e.key)) {
			e.preventDefault();
			e.stopPropagation();
		}

		let newIndex = currentAnchor;
		let handled = false;
		let isShiftNav = false;

		switch (e.key) {
			case 'ArrowDown':
				newIndex = findNextSelectableIndex(currentAnchor + 1, 1, currentListItems);
				isShiftNav = e.shiftKey;
				handled = true;
				break;
			case 'ArrowUp':
				newIndex = findNextSelectableIndex(currentAnchor - 1, -1, currentListItems);
				isShiftNav = e.shiftKey;
				handled = true;
				break;
			case 'PageDown':
				newIndex = findNextSelectableIndex(Math.min(currentAnchor + 10, currentListItems.length - 1), 1, currentListItems);
				handled = true;
				break;
			case 'PageUp':
				newIndex = findNextSelectableIndex(Math.max(currentAnchor - 10, 0), -1, currentListItems);
				handled = true;
				break;
			case 'Home':
				newIndex = findNextSelectableIndex(0, 1, currentListItems);
				handled = true;
				break;
			case 'End':
				newIndex = findNextSelectableIndex(currentListItems.length - 1, -1, currentListItems);
				handled = true;
				break;
			case 'Enter':
				if (currentSelected.size > 0) {
					handleToConsole();
					handled = true;
				}
				break;
			case 'Delete':
			case 'Backspace':
				if (currentSelected.size > 0) {
					handleDelete();
					handled = true;
				}
				break;
			case 'Escape':
				if (currentSearchText) {
					handleClearSearch();
					handled = true;
				}
				break;
		}

		if (handled) {
			// For non-navigation keys, prevent default here
			if (!navigationKeys.includes(e.key)) {
				e.preventDefault();
				e.stopPropagation();
			}

			if (newIndex !== currentAnchor && newIndex >= 0) {
				if (isShiftNav) {
					// Shift+Arrow: rebuild selection as inclusive range from a fixed range anchor.
					// If this is the first Shift press, lock the range anchor to the current position.
					if (rangeAnchorRef.current < 0) {
						rangeAnchorRef.current = currentAnchor;
					}
					const rangeStart = Math.min(rangeAnchorRef.current, newIndex);
					const rangeEnd = Math.max(rangeAnchorRef.current, newIndex);
					const newSet = new Set<number>();
					for (let i = rangeStart; i <= rangeEnd; i++) {
						const listItem = currentListItems[i];
						if (listItem && listItem.type === 'entry') {
							newSet.add(i);
						}
					}
					updateSelectedIndices(newSet);
					updateAnchorIndex(newIndex);
				} else {
					// Plain navigation: single-select the new index and reset range anchor
					rangeAnchorRef.current = -1;
					updateSelectedIndices(new Set([newIndex]));
					updateAnchorIndex(newIndex);
				}
				// Scroll to the newly selected item, accounting for sticky header
				scrollItemIntoView(newIndex);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * Set up keyboard event listener on the container
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		// Add keyboard event listener to the container
		const keyDownHandler = (e: KeyboardEvent) => handleKeyDown(e);

		container.addEventListener('keydown', keyDownHandler);

		return () => {
			container.removeEventListener('keydown', keyDownHandler);
		};
	}, [handleKeyDown]);

	/**
	 * Set up listeners for input events on active sessions
	 */
	useEffect(() => {
		const disposables = new DisposableStore();

		// Rediscover languages whenever active sessions change
		discoverLanguages();

		// Listen for new input events from all active sessions
		const sessions = runtimeSessionService.activeSessions;
		sessions.forEach(session => {
			disposables.add(
				session.onDidReceiveRuntimeMessageInput(() => {
					// Reload history if this is the current language
					if (session.runtimeMetadata.languageId === currentLanguage) {
						loadHistory();
					}
					// Also update available languages
					discoverLanguages();
				})
			);
		});

		// Listen for new sessions starting
		disposables.add(
			runtimeSessionService.onWillStartSession(event => {
				// Rediscover languages when a new session starts
				discoverLanguages();

				disposables.add(
					event.session.onDidReceiveRuntimeMessageInput(() => {
						if (event.session.runtimeMetadata.languageId === currentLanguage) {
							loadHistory();
						}
						discoverLanguages();
					})
				);
			})
		);

		return () => {
			disposables.dispose();
		};
	}, [currentLanguage, runtimeSessionService, discoverLanguages, loadHistory]);

	/**
	 * Load history when language or search changes
	 */
	useEffect(() => {
		loadHistory();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentLanguage, debouncedSearchText, executionHistoryService]);

	/**
	 * Auto-scroll to bottom when new entries are added and user was already at bottom.
	 */
	useEffect(() => {
		const prevLength = prevListItemsLengthRef.current;
		prevListItemsLengthRef.current = listItems.length;

		if (listItems.length > prevLength && prevLength > 0 && isAtBottomRef.current) {
			if (listRef.current) {
				listRef.current.scrollToItem(listItems.length - 1, 'end');
			}
		}
	}, [listItems]);

	/**
	 * Auto-select first entry when list items change (for keyboard navigation)
	 */
	useEffect(() => {
		if (listItems.length > 0 && selectedIndices.size === 0) {
			// Find first entry (skip separators)
			const firstEntryIndex = listItems.findIndex(item => item.type === 'entry');
			if (firstEntryIndex >= 0) {
				selectSingle(firstEntryIndex);
			}
		}
		// Reset selection if list becomes empty
		if (listItems.length === 0) {
			updateSelectedIndices(new Set());
			updateAnchorIndex(-1);
		} else {
			// Remove any indices that are now out of bounds
			const validIndices = new Set<number>();
			let changed = false;
			for (const idx of selectedIndices) {
				if (idx < listItems.length && listItems[idx]?.type === 'entry') {
					validIndices.add(idx);
				} else {
					changed = true;
				}
			}
			if (changed) {
				updateSelectedIndices(validIndices);
				if (!validIndices.has(anchorIndex)) {
					const remaining = Array.from(validIndices).sort((a, b) => a - b);
					updateAnchorIndex(remaining.length > 0 ? remaining[0] : -1);
				}
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [listItems]);

	/**
	 * Force re-render when dimensions change to ensure list is rendered properly
	 */
	useEffect(() => {
		// Only force reset when transitioning from invalid to valid dimensions
		const hadValidDimensions = lastValidWidthRef.current > 0 && lastValidHeightRef.current > 40;
		const hasValidDimensions = width > 0 && height > 40;

		if (!hadValidDimensions && hasValidDimensions && listRef.current && listItems.length > 0 && containerRef.current) {
			// Dimensions just became valid - force re-render once
			const targetWindow = DOM.getWindow(containerRef.current);
			targetWindow.requestAnimationFrame(() => {
				if (listRef.current) {
					listRef.current.resetAfterIndex(0);
				}
			});
		}
	}, [width, height, listItems.length]);

	// Compute the initial scroll offset so the list starts scrolled to the bottom
	const listHeight = Math.max(lastValidHeightRef.current, height) - 30;
	const totalContentHeight = getTotalContentHeight(listItems, anchorIndex);
	const initialScrollOffset = Math.max(0, totalContentHeight - listHeight);

	// Check if there is any history at all (for any language)
	const hasAnyHistory = availableLanguages.length > 0;

	return (
		<PositronActionBarContextProvider {...props}>
			<div className='positron-history-panel'>
				<PositronActionBar
					borderBottom={true}
					borderTop={true}
					paddingRight={8}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							ariaLabel={positronHistoryToConsoleTooltip}
							disabled={selectedIndices.size === 0}
							icon={Codicon.play}
							label={positronHistoryToConsole}
							tooltip={positronHistoryToConsoleTooltip}
							onPressed={handleToConsole}
						/>
						<ActionBarButton
							ariaLabel={positronHistoryToSourceTooltip}
							disabled={selectedIndices.size === 0}
							icon={Codicon.insert}
							label={positronHistoryToSource}
							tooltip={positronHistoryToSourceTooltip}
							onPressed={handleToSource}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							ariaLabel={positronHistoryCopyTooltip}
							disabled={selectedIndices.size === 0}
							icon={Codicon.copy}
							tooltip={positronHistoryCopyTooltip}
							onPressed={handleCopy}
						/>
						<ActionBarButton
							ariaLabel={positronHistoryDeleteTooltip}
							disabled={selectedIndices.size === 0}
							icon={Codicon.trash}
							tooltip={positronHistoryDeleteTooltip}
							onPressed={handleDelete}
						/>
					</ActionBarRegion>
					{hasAnyHistory && (
						<ActionBarRegion location='right'>
							<LanguageFilterMenuButton
								availableLanguages={availableLanguages}
								currentLanguage={currentLanguage}
								onSelectLanguage={handleSelectLanguage}
							/>
							<ActionBarFilter
								ref={filterRef}
								initialFilterText={searchText}
								placeholder={positronHistorySearch}
								width={100}
								onFilterTextChanged={handleSearchTextChange}
							/>
							<ActionBarSeparator />
							<ActionBarButton
								ariaLabel={positronHistoryClearAllTooltip}
								icon={Codicon.clearAll}
								tooltip={positronHistoryClearAllTooltip}
								onPressed={handleClearAll}
							/>
						</ActionBarRegion>
					)}
				</PositronActionBar>

				<div
					ref={containerRef}
					className='history-list-container'
					tabIndex={0}
				>
					{/* Floating sticky header */}
					{stickyHeaderLabel && listItems.length > 0 && (
						<HistorySeparator
							className='history-sticky-header'
							label={stickyHeaderLabel}
							style={{}}
							onClick={handleStickyHeaderClick}
						/>
					)}

					{listItems.length === 0 && debouncedSearchText ? (
						<div className='history-no-match-message'>
							<div className='history-no-match-text'>
								{positronHistoryNoMatches(debouncedSearchText)}
							</div>
							<button
								className='history-clear-search-button monaco-button monaco-text-button'
								onClick={handleClearSearch}
							>
								{positronHistoryClearSearch}
							</button>
						</div>
					) : listItems.length === 0 ? (
						null
					) : (lastValidWidthRef.current > 0 && lastValidHeightRef.current > 40) ? (
						<List
							ref={listRef}
							height={listHeight}
							initialScrollOffset={initialScrollOffset}
							innerElementType={StickyInnerElement}
							itemCount={listItems.length}
							itemSize={getRowHeight}
							overscanCount={5}
							width={Math.max(lastValidWidthRef.current, width)}
							onScroll={handleScroll}
						>
							{({ index, style }) => {
								const item = listItems[index];
								if (item.type === 'separator') {
									return (
										<HistorySeparator
											label={item.label}
											style={style}
											onClick={() => {
												// Select the first entry after this separator
												const nextEntryIndex = findNextSelectableIndex(index + 1, 1, listItems);
												if (nextEntryIndex >= 0) {
													handleSelect(nextEntryIndex);
												}
											}}
										/>
									);
								} else {
									return (
										<HistoryEntry
											fontInfo={props.fontInfo}
											historyItem={item}
											instantiationService={instantiationService}
											isSelected={selectedIndices.has(index)}
											languageId={currentLanguage || ''}
											searchText={debouncedSearchText}
											style={style}
											onCopy={() => handleCopy()}
											onDelete={() => handleDelete()}
											onKeyDown={handleKeyDown}
											onSelect={(e) => handleSelect(index, e)}
											onToConsole={() => handleToConsole()}
											onToSource={() => handleToSource()}
										/>
									);
								}
							}}
						</List>
					) : (
						<div className='history-empty-message'>
							{positronHistoryLoading}
						</div>
					)}
				</div>
			</div>
		</PositronActionBarContextProvider>
	);
};
