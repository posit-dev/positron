/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { Delayer } from '../../../../../base/common/async.js';
import { IExecutionHistoryService, IInputHistoryEntry } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { CodeAttributionSource } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarFilter } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { LanguageFilterMenuButton } from './languageFilterMenuButton.js';
import { HistoryEntry } from './historyEntry.js';
import { HistorySeparator } from './historySeparator.js';
import { getSectionLabel, isSameSection } from './historyGrouping.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import './positronHistoryPanel.css';

/**
 * Props for the PositronHistoryPanel component
 */
interface PositronHistoryPanelProps {
	reactComponentContainer: IReactComponentContainer;
	executionHistoryService: IExecutionHistoryService;
	runtimeSessionService: IRuntimeSessionService;
	instantiationService: IInstantiationService;
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
		instantiationService
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
	const disposablesRef = useRef<DisposableStore>(new DisposableStore());
	const searchDelayerRef = useRef<Delayer<void>>(new Delayer<void>(300));
	const filterRef = useRef<any>(null);
	const selectedIndexRef = useRef<number>(selectedIndex);
	const listItemsRef = useRef<ListItem[]>(listItems);
	const debouncedSearchTextRef = useRef<string>(debouncedSearchText);

	// Keep refs in sync with state
	useEffect(() => {
		selectedIndexRef.current = selectedIndex;
	}, [selectedIndex]);

	useEffect(() => {
		listItemsRef.current = listItems;
	}, [listItems]);

	useEffect(() => {
		debouncedSearchTextRef.current = debouncedSearchText;
	}, [debouncedSearchText]);

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
			if (listRef.current) {
				requestAnimationFrame(() => {
					if (listRef.current) {
						listRef.current.resetAfterIndex(index);
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
	 */
	const createListItems = (entries: IInputHistoryEntry[]): ListItem[] => {
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
	};

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
	 * Load history entries for the current language
	 */
	const loadHistory = () => {
		if (currentLanguage) {
			const historyEntries = executionHistoryService.getInputEntries(currentLanguage);

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
	};

	/**
	 * Discover all available languages from history
	 */
	const discoverLanguages = () => {
		// Get all active sessions to determine which languages are available
		const sessions = runtimeSessionService.activeSessions;
		const languageSet = new Set<string>();

		sessions.forEach(session => {
			const languageId = session.runtimeMetadata.languageId;
			// Add all session languages, not just those with history
			languageSet.add(languageId);
		});

		setAvailableLanguages(Array.from(languageSet));
	};

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
	 * Handle selection change
	 */
	const handleSelect = (index: number) => {
		// Skip separators
		const item = listItems[index];
		if (!item || item.type === 'separator') {
			return;
		}

		setSelectedIndex(index);
		// Focus the container to ensure active selection styling and keyboard navigation
		if (containerRef.current && document.activeElement !== containerRef.current) {
			containerRef.current.focus();
			setHasFocus(true);
		}
		// Scroll to make the selected item visible
		if (listRef.current) {
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
		const idx = (typeof index === 'number') ? index : selectedIndex;
		if (idx < 0 || idx >= listItems.length || !currentLanguage) {
			return;
		}

		const item = listItems[idx];
		if (item.type === 'separator') {
			return;
		}

		const entry = item.entry;
		const consoleService = instantiationService.invokeFunction(accessor =>
			accessor.get(IPositronConsoleService)
		);

		// Execute the code in the console without focusing it
		consoleService.executeCode(
			currentLanguage,
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
	 * Handle "To Source" button - inserts selected code at cursor position
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
		if (!editor) {
			return;
		}

		const position = editor.getPosition();
		if (!position) {
			return;
		}

		// Insert the code at the cursor position with a trailing newline
		(editor as any).executeEdits('positron-history', [{
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
		const disposables = disposablesRef.current;

		// Listen for size changes
		disposables.add(
			reactComponentContainer.onSizeChanged(size => {
				setWidth(size.width);
				setHeight(size.height);
			})
		);

		// Listen for foreground session changes
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

		// Initialize with foreground session language if available
		const foregroundSession = runtimeSessionService.foregroundSession;
		if (foregroundSession) {
			setCurrentLanguage(foregroundSession.runtimeMetadata.languageId);
		}

		// Initial discovery of languages
		discoverLanguages();

		// Initial size
		setWidth(reactComponentContainer.width);
		setHeight(reactComponentContainer.height);

		// Add focus/blur listeners to the container to track focus state
		const container = containerRef.current;
		const handleFocus = () => setHasFocus(true);
		const handleBlur = () => setHasFocus(false); if (container) {
			container.addEventListener('focus', handleFocus);
			container.addEventListener('blur', handleBlur);
		}

		return () => {
			disposables.dispose();
			if (container) {
				container.removeEventListener('focus', handleFocus);
				container.removeEventListener('blur', handleBlur);
			}
		};
	}, []);

	/**
	 * Set up keyboard event listener
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		// Add keyboard event listener to the container
		const handleKeyDown = (e: KeyboardEvent) => {
			const currentListItems = listItemsRef.current;
			const currentSelectedIndex = selectedIndexRef.current;
			const currentSearchText = debouncedSearchTextRef.current;

			if (currentListItems.length === 0) {
				return;
			} let newIndex = currentSelectedIndex;
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
						handleToConsole();
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
				e.preventDefault();
				e.stopPropagation();

				if (newIndex !== currentSelectedIndex && newIndex >= 0) {
					setSelectedIndex(newIndex);
					// Scroll to the newly selected item
					if (listRef.current) {
						listRef.current.scrollToItem(newIndex, 'smart');
					}
				}
			}
		};

		container.addEventListener('keydown', handleKeyDown);

		return () => {
			container.removeEventListener('keydown', handleKeyDown);
		};
	}, []);

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
	}, [currentLanguage]);

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
	 * Scroll to bottom when entries change (new entries added)
	 */
	useEffect(() => {
		if (autoScrollEnabled && listItems.length > 0 && listRef.current) {
			// Use requestAnimationFrame to ensure DOM is fully updated before scrolling
			requestAnimationFrame(() => {
				if (listRef.current && autoScrollEnabled) {
					listRef.current.scrollToItem(listItems.length - 1, 'end');
				}
			});
		}
	}, [listItems.length, autoScrollEnabled]);

	return (
		<PositronActionBarContextProvider {...props}>
			<div className="positron-history-panel">
				<PositronActionBar
					borderTop={false}
					borderBottom={true}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							icon={Codicon.play}
							label={(() => localize('positronHistoryToConsole', "To Console"))()}
							tooltip={(() => localize('positronHistoryToConsole', "To Console"))()}
							ariaLabel={(() => localize('positronHistoryToConsole', "To Console"))()}
							disabled={selectedIndex < 0}
							onPressed={handleToConsole}
						/>
						<ActionBarButton
							icon={Codicon.insert}
							label={(() => localize('positronHistoryToSource', "To Source"))()}
							tooltip={(() => localize('positronHistoryToSource', "To Source"))()}
							ariaLabel={(() => localize('positronHistoryToSource', "To Source"))()}
							disabled={selectedIndex < 0}
							onPressed={handleToSource}
						/>
						<ActionBarButton
							icon={Codicon.copy}
							label={(() => localize('positronHistoryCopy', "Copy"))()}
							tooltip={(() => localize('positronHistoryCopy', "Copy"))()}
							ariaLabel={(() => localize('positronHistoryCopy', "Copy"))()}
							disabled={selectedIndex < 0}
							onPressed={handleCopy}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<LanguageFilterMenuButton
							currentLanguage={currentLanguage}
							availableLanguages={availableLanguages}
							onSelectLanguage={handleSelectLanguage}
						/>
						<ActionBarFilter
							ref={filterRef}
							width={100}
							placeholder={(() => localize('positronHistorySearch', "Search"))()}
							initialFilterText={searchText}
							onFilterTextChanged={handleSearchTextChange}
						/>
					</ActionBarRegion>
				</PositronActionBar>

				<div
					ref={containerRef}
					className="history-list-container"
					tabIndex={0}
				>
					{/* Floating sticky header */}
					{stickyHeaderLabel && listItems.length > 0 && (
						<div className="history-sticky-header">
							<div className="history-separator-content">
								<span className="history-separator-label">{stickyHeaderLabel}</span>
							</div>
						</div>
					)}

					{listItems.length === 0 && debouncedSearchText ? (
						<div className="history-no-match-message">
							<div className="history-no-match-text">
								{localize('positronHistoryNoMatches', "No history entries matching '{0}' were found.", debouncedSearchText)}
							</div>
							<button
								className="history-clear-search-button monaco-button monaco-text-button"
								onClick={handleClearSearch}
							>
								{localize('positronHistoryClearSearch', "Clear Search")}
							</button>
						</div>
					) : listItems.length === 0 ? (
						<div className="history-empty-message">
							No history available
						</div>
					) : (
						<List
							ref={listRef}
							height={height - 40} // Subtract toolbar height
							width={width}
							itemCount={listItems.length}
							itemSize={getRowHeight}
							onScroll={handleScroll}
							innerElementType={StickyInnerElement}
							overscanCount={5}
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
											index={item.originalIndex}
											style={style}
											isSelected={index === selectedIndex}
											hasFocus={hasFocus}
											languageId={currentLanguage || ''}
											searchText={debouncedSearchText}
											onSelect={() => handleSelect(index)}
											onHeightChange={(height: number) => updateRowHeight(item.originalIndex, height)}
											onToConsole={() => {
												setSelectedIndex(index);
												handleToConsole(index);
											}}
											onToSource={() => {
												setSelectedIndex(index);
												handleToSource(index);
											}}
											onCopy={() => {
												setSelectedIndex(index);
												handleCopy(index);
											}}
											instantiationService={instantiationService}
											fontInfo={props.fontInfo}
										/>
									);
								}
							}}
						</List>
					)}
				</div>
			</div>
		</PositronActionBarContextProvider>
	);
};
