/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
import { HistoryEntry } from './historyEntry.js';
import { HistorySeparator } from './historySeparator.js';
import { getSectionLabel, isSameSection } from './historyGrouping.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
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
 * Type for list items - can be either a history entry or a separator
 */
type ListItem = {
	type: 'entry';
	entry: IInputHistoryEntry;
	originalIndex: number; // Index in the original entries array
} | {
	type: 'separator';
	label: string;
};

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
	const [selectedIndex, setSelectedIndex] = useState<number>(-1);
	const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(undefined);
	const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);
	const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
	const [hasFocus, setHasFocus] = useState(false);
	const [stickyHeaderLabel, setStickyHeaderLabel] = useState<string | null>(null);
	const [searchText, setSearchText] = useState<string>('');
	const [debouncedSearchText, setDebouncedSearchText] = useState<string>('');

	// Refs
	const listRef = useRef<List>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const rowHeightsRef = useRef<Map<number, number>>(new Map());
	const searchDelayerRef = useRef<Delayer<void>>(new Delayer<void>(300));
	const sizeDelayerRef = useRef<Delayer<void>>(new Delayer<void>(25));
	const filterRef = useRef<any>(null);
	const hasInitializedSizeRef = useRef<boolean>(false);
	const selectedIndexRef = useRef<number>(selectedIndex);
	const listItemsRef = useRef<ListItem[]>(listItems);
	const debouncedSearchTextRef = useRef<string>(debouncedSearchText);
	const currentLanguageRef = useRef<string | undefined>(currentLanguage);
	const lastValidWidthRef = useRef<number>(0);
	const lastValidHeightRef = useRef<number>(0);
	const wasVisibleRef = useRef<boolean>(true);

	// Keep refs in sync with state
	useEffect(() => {
		selectedIndexRef.current = selectedIndex;
	}, [selectedIndex]);

	/**
	 * Restore focus to selected entry after selection changes cause a re-render.
	 * react-window may recreate DOM elements during re-render, causing focus loss.
	 */
	useEffect(() => {
		if (selectedIndex >= 0 && containerRef.current) {
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
	}, [selectedIndex]);

	useEffect(() => {
		listItemsRef.current = listItems;
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
	 * Get the height of a row
	 */
	const getRowHeight = (index: number): number => {
		const item = listItems[index];
		if (!item) {
			return DEFAULT_ROW_HEIGHT;
		}
		if (item.type === 'separator') {
			return SEPARATOR_HEIGHT;
		}
		return rowHeightsRef.current.get(item.originalIndex) || DEFAULT_ROW_HEIGHT;
	};

	/**
	 * Update the height of a row
	 */
	const updateRowHeight = (index: number, height: number) => {
		const currentHeight = rowHeightsRef.current.get(index);
		// Only update if height changed by more than 1px to avoid scroll jumps from minor rendering differences
		const heightDiff = currentHeight !== undefined ? Math.abs(currentHeight - height) : Infinity;
		if (heightDiff > 1) {
			rowHeightsRef.current.set(index, height);
			// Reset the list after this index to recalculate positions
			// Use requestAnimationFrame to avoid interrupting user scrolling
			if (listRef.current && containerRef.current) {
				const targetWindow = DOM.getWindow(containerRef.current);
				// Save currently focused element before reset
				const activeElement = targetWindow.document.activeElement as HTMLElement | null;
				const wasHistoryEntry = activeElement?.classList.contains('history-entry');

				targetWindow.requestAnimationFrame(() => {
					if (listRef.current) {
						listRef.current.resetAfterIndex(index);

						// Restore focus to the selected entry after the list resets
						// Use another requestAnimationFrame to ensure the DOM has been updated
						if (wasHistoryEntry) {
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
					}
				});
			}
		} else if (currentHeight === undefined) {
			// First time measuring, just store it without resetting
			rowHeightsRef.current.set(index, height);
		}
	};

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

			// Add the entry
			items.push({ type: 'entry', entry, originalIndex: i });
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
	 * Handle "Copy" - copies selected code to clipboard
	 */
	const handleCopy = (index?: number) => {
		// When called from Button, index will be KeyboardModifiers object, so treat it as undefined
		const idx = (typeof index === 'number') ? index : selectedIndex;
		if (idx < 0 || idx >= listItems.length) {
			return;
		}

		const item = listItems[idx];
		if (item.type === 'separator') {
			return;
		}

		const entry = item.entry;
		const clipboardService = instantiationService.invokeFunction(accessor =>
			accessor.get(IClipboardService)
		);

		clipboardService.writeText(entry.input);
	};

	/**
	 * Handle "Delete" - deletes the selected history entry
	 */
	const handleDelete = (index?: number) => {
		// When called from Button, index will be KeyboardModifiers object, so treat it as undefined
		const idx = (typeof index === 'number') ? index : selectedIndexRef.current;
		const items = listItemsRef.current;
		const language = currentLanguageRef.current;
		if (idx < 0 || idx >= items.length || !language) {
			return;
		}

		const item = items[idx];
		if (item.type === 'separator') {
			return;
		}

		const entry = item.entry;

		// Calculate the new selection BEFORE deleting (using current items)
		// Find the next selectable item after the current one, or previous if at end
		let newSelectedIndex = findNextSelectableIndex(idx + 1, 1, items);
		if (newSelectedIndex === -1 || newSelectedIndex === idx) {
			// No items after, try finding one before
			newSelectedIndex = findNextSelectableIndex(idx - 1, -1, items);
		}

		// Delete the entry from the service
		executionHistoryService.deleteInputEntry(language, entry.when, entry.input);

		// Update selection before reloading to avoid flickering
		// After deletion, indices shift down, so the next item will be at the same index
		// But if we selected the previous item, we need to adjust
		if (newSelectedIndex > idx) {
			// Selected an item after the deleted one - it will shift down by 1
			setSelectedIndex(newSelectedIndex - 1);
		} else {
			// Selected an item before the deleted one - index stays the same
			setSelectedIndex(newSelectedIndex);
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

			// Filter out consecutive duplicates
			const filteredEntries = historyEntries.filter((entry, index) => {
				if (index === 0) {
					return true;
				}
				return entry.input !== historyEntries[index - 1].input;
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
	 * Handle language selection from dropdown
	 */
	const handleSelectLanguage = (languageId: string) => {
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
			setSelectedIndex(-1);
			// Reload the history to update the UI
			loadHistory();
		}
	};

	/**
	 * Check if an item at the given index is fully visible in the viewport
	 */
	const isItemFullyVisible = (index: number): boolean => {
		if (!listRef.current || !containerRef.current) {
			return false;
		}

		// Get the scroll offset from the list's internal state
		// We need to calculate the item's position based on accumulated heights
		let itemTop = 0;
		for (let i = 0; i < index; i++) {
			itemTop += getRowHeight(i);
		}
		const itemHeight = getRowHeight(index);
		const itemBottom = itemTop + itemHeight;

		// Get the current scroll position and viewport height
		const listElement = containerRef.current.querySelector('[class*="react-window"]') as HTMLElement;
		if (!listElement) {
			return false;
		}

		const scrollTop = listElement.scrollTop;
		const viewportHeight = height - 40; // Subtract toolbar height

		// Check if the item is fully within the visible area
		return itemTop >= scrollTop && itemBottom <= scrollTop + viewportHeight;
	};

	/**
	 * Handle selection change
	 */
	const handleSelect = (index: number) => {
		// Skip separators
		const item = listItems[index];
		if (!item || item.type === 'separator') {
			return;
		}

		setSelectedIndex(index);

		// Only scroll if the item is not already fully visible
		if (listRef.current && !isItemFullyVisible(index)) {
			listRef.current.scrollToItem(index, 'smart');
		}
	};

	/**
	 * Handle scroll event to update auto-scroll state and sticky header
	 */
	const handleScroll = ({ scrollOffset, scrollUpdateWasRequested }: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => {
		if (!scrollUpdateWasRequested && listRef.current) {
			// User scrolled manually - check if they scrolled away from bottom
			const totalHeight = listItems.reduce((sum, _, i) => sum + getRowHeight(i), 0);
			const viewportHeight = height - 40; // Subtract toolbar height
			// Use a larger threshold (1.5x default row height) to account for dynamic height changes
			const threshold = DEFAULT_ROW_HEIGHT * 1.5;
			const isAtBottom = scrollOffset + viewportHeight >= totalHeight - threshold;
			setAutoScrollEnabled(isAtBottom);
		}

		// Find which section is currently at the top of the viewport
		let currentOffset = 0;
		let currentSectionLabel: string | null = null;

		for (let i = 0; i < listItems.length; i++) {
			const item = listItems[i];
			const itemHeight = getRowHeight(i);

			if (item.type === 'separator') {
				// If we haven't scrolled past this separator yet, it's the current section
				if (currentOffset + itemHeight > scrollOffset) {
					currentSectionLabel = item.label;
					break;
				}
				// Update the current section label as we pass each separator
				currentSectionLabel = item.label;
			}

			currentOffset += itemHeight;

			// If we've gone past the scroll position, use the last separator we saw
			if (currentOffset > scrollOffset) {
				break;
			}
		}

		setStickyHeaderLabel(currentSectionLabel);
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
	 * Handle keyboard navigation in the history list
	 */
	/**
	 * Handle "To Console" button - sends selected code to console
	 */
	const handleToConsole = (index?: number) => {
		// When called from Button, index will be KeyboardModifiers object, so treat it as undefined
		const idx = (typeof index === 'number') ? index : selectedIndexRef.current;
		const items = listItemsRef.current;
		const language = currentLanguageRef.current;
		if (idx < 0 || idx >= items.length || !language) {
			return;
		}

		const item = items[idx];
		if (item.type === 'separator') {
			return;
		}

		const entry = item.entry;
		const consoleService = instantiationService.invokeFunction(accessor =>
			accessor.get(IPositronConsoleService)
		);

		// Execute the code in the console without focusing it
		consoleService.executeCode(
			language,
			undefined, // session ID - use any available session
			entry.input,
			{ source: CodeAttributionSource.Interactive }, // attribution
			true, // focus the console
			undefined, // allow incomplete
			undefined, // mode
			undefined, // error behavior
			undefined  // execution ID
		);
	};

	/**
	 * Handle "To Source" button - inserts selected code at cursor position or opens new untitled buffer
	 */
	const handleToSource = (index?: number) => {
		// When called from Button, index will be KeyboardModifiers object, so treat it as undefined
		const idx = (typeof index === 'number') ? index : selectedIndex;
		if (idx < 0 || idx >= listItems.length) {
			return;
		}

		const item = listItems[idx];
		if (item.type === 'separator') {
			return;
		}

		const entry = item.entry;
		const editorService = instantiationService.invokeFunction(accessor =>
			accessor.get(IEditorService)
		);

		const editor = editorService.activeTextEditorControl;
		if (!editor || !isCodeEditor(editor)) {
			// No active editor - open a new untitled buffer with the code
			editorService.openEditor({
				contents: entry.input,
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
			text: entry.input + '\n'
		}]);
	};

	/**
	 * Initialize - set up event listeners
	 */
	useEffect(() => {
		const disposables = new DisposableStore();

		// Listen for size changes with debouncing to prevent flickering during resize
		disposables.add(
			reactComponentContainer.onSizeChanged(size => {
				// Store valid dimensions immediately for use as fallback
				if (size.width > 0 && size.height > 0) {
					const widthDiff = Math.abs(size.width - lastValidWidthRef.current);
					const heightDiff = Math.abs(size.height - lastValidHeightRef.current);

					// For initial size or significant changes, update immediately without debounce
					if (!hasInitializedSizeRef.current || widthDiff > 50 || heightDiff > 50) {
						lastValidWidthRef.current = size.width;
						lastValidHeightRef.current = size.height;
						setWidth(size.width);
						setHeight(size.height);
						hasInitializedSizeRef.current = true;
					} else if (widthDiff > 5 || heightDiff > 5) {
						// For smaller changes, debounce to prevent flickering during resize
						sizeDelayerRef.current.trigger(() => {
							lastValidWidthRef.current = size.width;
							lastValidHeightRef.current = size.height;
							setWidth(size.width);
							setHeight(size.height);
							return Promise.resolve();
						});
					}
				}
			})
		);		// Listen for foreground session changes
		disposables.add(
			runtimeSessionService.onDidChangeForegroundSession(session => {
				if (session) {
					const languageId = session.runtimeMetadata.languageId;
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
		const handleFocus = () => setHasFocus(true);
		const handleBlur = () => setHasFocus(false); if (container) {
			container.addEventListener('focus', handleFocus);
			container.addEventListener('blur', handleBlur);
		}

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
			if (container) {
				container.removeEventListener('focus', handleFocus);
				container.removeEventListener('blur', handleBlur);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * Handle keyboard navigation in the history list.
	 * This is used both by the container's keydown listener and by HistoryEntry components.
	 */
	const handleKeyDown = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
		const currentListItems = listItemsRef.current;
		const currentSelectedIndex = selectedIndexRef.current;
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

		let newIndex = currentSelectedIndex;
		let handled = false;

		switch (e.key) {
			case 'ArrowDown':
				newIndex = findNextSelectableIndex(currentSelectedIndex + 1, 1, currentListItems);
				handled = true;
				break;
			case 'ArrowUp':
				newIndex = findNextSelectableIndex(currentSelectedIndex - 1, -1, currentListItems);
				handled = true;
				break;
			case 'PageDown':
				newIndex = findNextSelectableIndex(Math.min(currentSelectedIndex + 10, currentListItems.length - 1), 1, currentListItems);
				handled = true;
				break;
			case 'PageUp':
				newIndex = findNextSelectableIndex(Math.max(currentSelectedIndex - 10, 0), -1, currentListItems);
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
				if (currentSelectedIndex >= 0) {
					handleToConsole(currentSelectedIndex);
					handled = true;
				}
				break;
			case 'Delete':
			case 'Backspace':
				if (currentSelectedIndex >= 0) {
					handleDelete(currentSelectedIndex);
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

			if (newIndex !== currentSelectedIndex && newIndex >= 0) {
				setSelectedIndex(newIndex);
				// Scroll to the newly selected item
				if (listRef.current) {
					listRef.current.scrollToItem(newIndex, 'smart');
				}
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
	 * Auto-select first entry when list items change (for keyboard navigation)
	 */
	useEffect(() => {
		if (listItems.length > 0 && selectedIndex === -1) {
			// Find first entry (skip separators)
			const firstEntryIndex = listItems.findIndex(item => item.type === 'entry');
			if (firstEntryIndex >= 0) {
				setSelectedIndex(firstEntryIndex);
			}
		}
		// Reset selection if list becomes empty or current selection is out of bounds
		if (listItems.length === 0 || selectedIndex >= listItems.length) {
			setSelectedIndex(-1);
		}
	}, [listItems, selectedIndex]);

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

	/**
	 * Scroll to bottom when entries change (new entries added)
	 */
	useEffect(() => {
		if (autoScrollEnabled && listItems.length > 0 && listRef.current && containerRef.current) {
			// Use requestAnimationFrame to ensure DOM is fully updated before scrolling
			const targetWindow = DOM.getWindow(containerRef.current);
			targetWindow.requestAnimationFrame(() => {
				if (listRef.current && autoScrollEnabled) {
					listRef.current.scrollToItem(listItems.length - 1, 'end');
				}
			});
		}
	}, [listItems.length, autoScrollEnabled]);

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
							disabled={selectedIndex < 0}
							icon={Codicon.play}
							label={positronHistoryToConsole}
							tooltip={positronHistoryToConsoleTooltip}
							onPressed={handleToConsole}
						/>
						<ActionBarButton
							ariaLabel={positronHistoryToSourceTooltip}
							disabled={selectedIndex < 0}
							icon={Codicon.insert}
							label={positronHistoryToSource}
							tooltip={positronHistoryToSourceTooltip}
							onPressed={handleToSource}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							ariaLabel={positronHistoryCopyTooltip}
							disabled={selectedIndex < 0}
							icon={Codicon.copy}
							tooltip={positronHistoryCopyTooltip}
							onPressed={handleCopy}
						/>
						<ActionBarButton
							ariaLabel={positronHistoryDeleteTooltip}
							disabled={selectedIndex < 0}
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
							style={{}} />
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
							height={Math.max(lastValidHeightRef.current, height) - 40} // Subtract toolbar height
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
										/>
									);
								} else {
									return (
										<HistoryEntry
											entry={item.entry}
											fontInfo={props.fontInfo}
											hasFocus={hasFocus}
											index={item.originalIndex}
											instantiationService={instantiationService}
											isSelected={index === selectedIndex}
											languageId={currentLanguage || ''}
											searchText={debouncedSearchText}
											style={style}
											onCopy={() => {
												setSelectedIndex(index);
												handleCopy(index);
											}}
											onDelete={() => {
												setSelectedIndex(index);
												handleDelete(index);
											}}
											onHeightChange={(height: number) => updateRowHeight(item.originalIndex, height)}
											onKeyDown={handleKeyDown}
											onSelect={() => handleSelect(index)}
											onToConsole={() => {
												setSelectedIndex(index);
												handleToConsole(index);
											}}
											onToSource={() => {
												setSelectedIndex(index);
												handleToSource(index);
											}}
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
