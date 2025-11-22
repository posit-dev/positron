/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
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
import { LanguageFilterMenuButton } from './languageFilterMenuButton.js';
import { HistoryEntry } from './historyEntry.js';
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
 * The default height for a history entry row (3 lines of code)
 * With minimal padding and tight line height, ~40px should be enough for 3 lines
 */
const DEFAULT_ROW_HEIGHT = 40;

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
	const [entries, setEntries] = useState<IInputHistoryEntry[]>([]);
	const [selectedIndex, setSelectedIndex] = useState<number>(-1);
	const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(undefined);
	const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);
	const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
	const [hasFocus, setHasFocus] = useState(false);

	// Refs
	const listRef = useRef<List>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const rowHeightsRef = useRef<Map<number, number>>(new Map());
	const disposablesRef = useRef<DisposableStore>(new DisposableStore());

	/**
	 * Get the height of a row
	 */
	const getRowHeight = (index: number): number => {
		return rowHeightsRef.current.get(index) || DEFAULT_ROW_HEIGHT;
	};

	/**
	 * Update the height of a row
	 */
	const updateRowHeight = (index: number, height: number) => {
		const currentHeight = rowHeightsRef.current.get(index);
		if (currentHeight !== height) {
			rowHeightsRef.current.set(index, height);
			// Reset the list after this index to recalculate positions
			if (listRef.current) {
				listRef.current.resetAfterIndex(index);
			}
		}
	};

	/**
	 * Handle "Copy" - copies selected code to clipboard
	 */
	const handleCopy = (index?: number) => {
		const idx = index !== undefined ? index : selectedIndex;
		if (idx < 0 || idx >= entries.length) {
			return;
		}

		const entry = entries[idx];
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

			setEntries(filteredEntries);

			// Auto-scroll to bottom if enabled
			if (autoScrollEnabled && filteredEntries.length > 0 && listRef.current) {
				setTimeout(() => {
					listRef.current?.scrollToItem(filteredEntries.length - 1, 'end');
				}, 0);
			}
		}
	};

	/**
	 * Discover all available languages from history
	 */
	const discoverLanguages = () => {
		// Get all active sessions to determine which languages have history
		const sessions = runtimeSessionService.activeSessions;
		const languageSet = new Set<string>();

		sessions.forEach(session => {
			const languageId = session.runtimeMetadata.languageId;
			// Check if this language has any history
			const langHistory = executionHistoryService.getInputEntries(languageId);
			if (langHistory.length > 0) {
				languageSet.add(languageId);
			}
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
	 * Handle selection change
	 */
	const handleSelect = (index: number) => {
		setSelectedIndex(index);
		// Focus the container to ensure active selection styling
		if (containerRef.current) {
			containerRef.current.focus();
		}
		// Scroll to make the selected item visible
		if (listRef.current) {
			listRef.current.scrollToItem(index, 'smart');
		}
	};

	/**
	 * Handle scroll event to update auto-scroll state
	 */
	const handleScroll = ({ scrollOffset, scrollUpdateWasRequested }: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => {
		if (!scrollUpdateWasRequested && listRef.current) {
			// User scrolled manually - check if they scrolled away from bottom
			const totalHeight = entries.reduce((sum, _, i) => sum + getRowHeight(i), 0);
			const isAtBottom = scrollOffset + height >= totalHeight - 10;
			setAutoScrollEnabled(isAtBottom);
		}
	};

	/**
	 * Handle keyboard navigation in the history list
	 */
	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (entries.length === 0) {
			return;
		}

		let newIndex = selectedIndex;
		let handled = false;

		switch (event.key) {
			case 'ArrowDown':
				newIndex = Math.min(selectedIndex + 1, entries.length - 1);
				handled = true;
				break;
			case 'ArrowUp':
				newIndex = Math.max(selectedIndex - 1, 0);
				handled = true;
				break;
			case 'PageDown':
				newIndex = Math.min(selectedIndex + 10, entries.length - 1);
				handled = true;
				break;
			case 'PageUp':
				newIndex = Math.max(selectedIndex - 10, 0);
				handled = true;
				break;
			case 'Home':
				newIndex = 0;
				handled = true;
				break;
			case 'End':
				newIndex = entries.length - 1;
				handled = true;
				break;
			case 'Enter':
				if (selectedIndex >= 0) {
					handleToConsole();
					handled = true;
				}
				break;
		}

		if (handled) {
			event.preventDefault();
			event.stopPropagation();

			if (newIndex !== selectedIndex) {
				setSelectedIndex(newIndex);
				// Scroll to the newly selected item
				if (listRef.current) {
					listRef.current.scrollToItem(newIndex, 'smart');
				}
			}
		}
	};	/**
	 * Handle "To Console" button - sends selected code to console
	 */
	const handleToConsole = (index?: number) => {
		const idx = index !== undefined ? index : selectedIndex;
		if (idx < 0 || idx >= entries.length || !currentLanguage) {
			return;
		}

		const entry = entries[idx];
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
		const idx = index !== undefined ? index : selectedIndex;
		if (idx < 0 || idx >= entries.length) {
			return;
		}

		const entry = entries[idx];
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

		return () => {
			disposables.dispose();
		};
	}, []);

	/**
	 * Set up listeners for input events on active sessions
	 */
	useEffect(() => {
		const disposables = new DisposableStore();

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
	 * Load history when language changes
	 */
	useEffect(() => {
		loadHistory();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentLanguage, executionHistoryService]);

	/**
	 * Scroll to bottom when entries change (new entries added)
	 */
	useEffect(() => {
		if (autoScrollEnabled && entries.length > 0 && listRef.current) {
			listRef.current.scrollToItem(entries.length - 1, 'end');
		}
	}, [entries.length, autoScrollEnabled]);

	/**
	 * Track focus state by monitoring focus/blur events on the document
	 */
	useEffect(() => {
		const updateFocusState = () => {
			if (containerRef.current) {
				const isFocused = containerRef.current.contains(document.activeElement);
				setHasFocus(isFocused);
			}
		};

		// Check immediately
		updateFocusState();

		// Listen to focus and blur events on the document
		document.addEventListener('focusin', updateFocusState);
		document.addEventListener('focusout', updateFocusState);

		return () => {
			document.removeEventListener('focusin', updateFocusState);
			document.removeEventListener('focusout', updateFocusState);
		};
	}, []);

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
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<LanguageFilterMenuButton
							currentLanguage={currentLanguage}
							availableLanguages={availableLanguages}
							onSelectLanguage={handleSelectLanguage}
						/>
					</ActionBarRegion>
				</PositronActionBar>

				<div
					ref={containerRef}
					className="history-list-container"
					onKeyDown={handleKeyDown}
					tabIndex={0}
				>
					{entries.length === 0 ? (
						<div className="history-empty-message">
							No history available
						</div>
					) : (
						<List
							ref={listRef}
							height={height - 40} // Subtract toolbar height
							width={width}
							itemCount={entries.length}
							itemSize={getRowHeight}
							onScroll={handleScroll}
						>
							{({ index, style }) => (
								<HistoryEntry
									entry={entries[index]}
									index={index}
									style={style}
									isSelected={index === selectedIndex}
									hasFocus={hasFocus}
									languageId={currentLanguage || ''}
									onSelect={() => handleSelect(index)}
									onHeightChange={(height: number) => updateRowHeight(index, height)}
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
							)}
						</List>
					)}
				</div>
			</div>
		</PositronActionBarContextProvider>
	);
};
