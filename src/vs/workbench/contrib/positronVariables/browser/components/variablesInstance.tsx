/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variablesInstance';
import * as React from 'react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import * as DOM from 'vs/base/browser/dom';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { VerticalSplitterResizeParams } from 'vs/base/browser/ui/positronComponents/splitters/verticalSplitter';
import { VariableItem } from 'vs/workbench/contrib/positronVariables/browser/components/variableItem';
import { VariableGroup } from 'vs/workbench/contrib/positronVariables/browser/components/variableGroup';
import { VariablesEmpty } from 'vs/workbench/contrib/positronVariables/browser/components/variablesEmpty';
import { VariableOverflow } from 'vs/workbench/contrib/positronVariables/browser/components/variableOverflow';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { VariableEntry, IPositronVariablesInstance, isVariableGroup, isVariableItem, isVariableOverflow } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';
import { RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IVariableItem } from 'vs/workbench/services/positronVariables/common/interfaces/variableItem';

/**
 * Constants.
 */
const LINE_HEIGHT = 26;
const DEFAULT_NAME_COLUMN_WIDTH = 130;
const MINIMUM_NAME_COLUMN_WIDTH = 100;
const RIGHT_COLUMN_VISIBILITY_THRESHOLD = 250;

/**
 * VariablesInstanceProps interface.
 */
interface VariablesInstanceProps {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronVariablesInstance: IPositronVariablesInstance;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
* VariablesInstance component.
* @param props A VariablesInstanceProps that contains the component properties.
* @returns The rendered component.
*/
export const VariablesInstance = (props: VariablesInstanceProps) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	// Reference hooks.
	const outerRef = useRef<HTMLDivElement>(undefined!);
	const listRef = useRef<List>(undefined!);
	const innerRef = useRef<HTMLElement>(undefined!);

	// State hooks.
	const [nameColumnWidth, setNameColumnWidth] = useState(DEFAULT_NAME_COLUMN_WIDTH);
	const [detailsColumnWidth, setDetailsColumnWidth] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH);
	const [rightColumnVisible, setRightColumnVisible] =
		useState(props.width - DEFAULT_NAME_COLUMN_WIDTH > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	const [initializing, setInitializing] = useState(true);
	const [variableEntries, setVariableEntries] = useState<VariableEntry[]>([]);
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [focused, setFocused] = useState(false);
	const [clientState, setClientState] = useState(props.positronVariablesInstance.state);
	const [, setScrollOffset, scrollOffsetRef] = useStateRef(0);
	const [, setScrollState, scrollStateRef] = useStateRef<number[] | undefined>(undefined);

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSaveScrollPosition event handler.
		disposableStore.add(props.reactComponentContainer.onSaveScrollPosition(() => {
			// Save the scroll state.
			if (innerRef.current) {
				setScrollState(DOM.saveParentsScrollTop(innerRef.current));
			}
		}));

		// Add the onRestoreScrollPosition event handler.
		disposableStore.add(props.reactComponentContainer.onRestoreScrollPosition(() => {
			// Restore the scroll state.
			if (scrollStateRef.current) {
				if (innerRef.current) {
					DOM.restoreParentsScrollTop(innerRef.current, scrollStateRef.current);
				}

				// Erase the saved scroll state.
				setScrollState(undefined);
			}
		}));

		// Add the onDidChangeEntries event handler.
		disposableStore.add(props.positronVariablesInstance.onDidChangeEntries(entries => {
			// When we've received the first set of entries, we are initialized.
			setInitializing(false);

			// Set the entries.
			setVariableEntries(entries);
		}));

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronVariablesInstance.onDidChangeState(state => {
			setClientState(state);
		}));

		// Register listener to drive focus inside the variable tree
		disposableStore.add(props.positronVariablesInstance.onFocusElement(state => {
			outerRef.current.focus();
		}));

		// Request the initial refresh.
		props.positronVariablesInstance.requestRefresh();

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [
		props.positronVariablesInstance,
		props.reactComponentContainer,
		scrollStateRef,
		setScrollState
	]);

	// Width useEffect hook.
	useEffect(() => {
		// Calculate the new details column width.
		const newDetailsColumnWidth = Math.max(
			props.width - nameColumnWidth,
			Math.trunc(props.width / 3)
		);

		// Adjust the column widths.
		setNameColumnWidth(props.width - newDetailsColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the right column visibility.
		setRightColumnVisible(newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	}, [nameColumnWidth, props.width]);

	// Entries useEffect hook.
	useEffect(() => {
		if (selectedId) {
			const selectedIndex = variableEntries.findIndex(entry => entry.id === selectedId);
			if (selectedIndex === -1) {
				setSelectedId(undefined);
			}
		}
	}, [selectedId, variableEntries]);

	// useEffect to scroll to recently defined variable(s).
	useEffect(() => {
		if (!listRef.current) {
			return;
		}
		for (let i = 0; i < variableEntries.length; i++) {
			const entry = variableEntries[i];
			if (isVariableItem(entry)) {
				const variable = entry as IVariableItem;
				if (variable.isRecent.get()) {
					listRef.current.scrollToItem(i);
					break;
				}
			}
		}
	}, [variableEntries]);

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		// Consumes the event.
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Calculates the max scroll offset.
		const maxScrollOffset = () => Math.max(
			(variableEntries.length * LINE_HEIGHT) - props.height,
			0
		);

		// Determine that a key is pressed without any modifiers
		const noModifierKey = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

		// Determine whether the cmd or ctrl key is pressed without other modifiers.
		const onlyCmdOrCtrlKey = (isMacintosh ? e.metaKey : e.ctrlKey) &&
			(isMacintosh ? !e.ctrlKey : !e.metaKey) &&
			!e.shiftKey &&
			!e.altKey;

		if (noModifierKey) {
			// Process the code.
			switch (e.code) {
				// Home key.
				case 'Home': {
					consumeEvent();
					listRef.current.scrollTo(0);
					return;
				}

				// End key.
				case 'End': {
					consumeEvent();
					listRef.current.scrollTo(maxScrollOffset());
					return;
				}

				// Page up key.
				case 'PageUp': {
					consumeEvent();
					listRef.current.scrollTo(Math.max(scrollOffsetRef.current - props.height, 0));
					return;
				}

				// Page down key.
				case 'PageDown': {
					consumeEvent();
					listRef.current.scrollTo(
						Math.min(
							scrollOffsetRef.current + props.height,
							maxScrollOffset()
						)
					);
					return;
				}

				// Up arrow key.
				case 'ArrowUp': {
					consumeEvent();
					if (!selectedId) {
						if (variableEntries.length) {
							setSelectedId(variableEntries[variableEntries.length - 1].id);
							listRef.current.scrollToItem(variableEntries.length - 1);
						}
					} else {
						const selectedIndex = variableEntries.findIndex(entry =>
							entry.id === selectedId
						);
						if (selectedIndex > 0) {
							const index = selectedIndex - 1;
							setSelectedId(variableEntries[index].id);
							listRef.current.scrollToItem(index);
						}
					}
					return;
				}

				// Down arrow key.
				case 'ArrowDown': {
					consumeEvent();
					if (!selectedId) {
						if (variableEntries.length) {
							setSelectedId(variableEntries[0].id);
							listRef.current.scrollToItem(0);
						}
					} else {
						const selectedEntryIndex = variableEntries.findIndex(entry =>
							entry.id === selectedId
						);
						if (selectedEntryIndex < variableEntries.length - 1) {
							const index = selectedEntryIndex + 1;
							setSelectedId(variableEntries[index].id);
							listRef.current.scrollToItem(index);
						}
					}
					return;
				}

				// Left arrow key.
				case 'ArrowLeft': {
					consumeEvent();
					if (selectedId) {
						const selectedEntryIndex = variableEntries.findIndex(entry =>
							entry.id === selectedId
						);
						const selectedVariableEntry = variableEntries[selectedEntryIndex];
						if (isVariableGroup(selectedVariableEntry)) {
							if (selectedVariableEntry.expanded) {
								props.positronVariablesInstance.collapseVariableGroup(
									selectedVariableEntry.id
								);
							}
						} else if (isVariableItem(selectedVariableEntry) &&
							selectedVariableEntry.hasChildren) {
							if (selectedVariableEntry.expanded) {
								props.positronVariablesInstance.collapseVariableItem(
									selectedVariableEntry.path
								);
							}
						}
					}
					return;
				}

				// Right arrow key.
				case 'ArrowRight': {
					consumeEvent();
					if (selectedId) {
						const selectedEntryIndex = variableEntries.findIndex(entry =>
							entry.id === selectedId
						);
						const selectedVariableEntry = variableEntries[selectedEntryIndex];
						if (isVariableGroup(selectedVariableEntry)) {
							if (!selectedVariableEntry.expanded) {
								props.positronVariablesInstance.expandVariableGroup(
									selectedVariableEntry.id
								);
							}
						} else if (isVariableItem(selectedVariableEntry) &&
							selectedVariableEntry.hasChildren) {
							if (!selectedVariableEntry.expanded) {
								props.positronVariablesInstance.expandVariableItem(
									selectedVariableEntry.path
								);
							}
						}
					}
					return;
				}

				default: {
					return;
				}
			}
		}

		if (onlyCmdOrCtrlKey) {
			switch (e.key) {
				// C key.
				case 'c': {
					// Process the key.
					if (selectedId) {
						const selectedEntryIndex = variableEntries.findIndex(entry =>
							entry.id === selectedId
						);
						const selectedEntry = variableEntries[selectedEntryIndex];
						if (isVariableItem(selectedEntry)) {
							consumeEvent();
							const text = await selectedEntry.formatForClipboard(
								e.shiftKey ? 'text/html' : 'text/plain'
							);
							positronVariablesContext.clipboardService.writeText(text);
						}
					}
					return;
				}

				default: {
					return;
				}
			}
		}
	};

	/**
	 * onBeginResizeNameColumn handler.
	 * @returns A VerticalSplitterResizeParams containing the resize parameters.
	 */
	const beginResizeNameColumnHandler = (): VerticalSplitterResizeParams => ({
		minimumWidth: MINIMUM_NAME_COLUMN_WIDTH,
		maximumWidth: Math.trunc(2 * props.width / 3),
		columnsWidth: nameColumnWidth
	});

	/**
	 * onResize event handler.
	 * @param newNameColumnWidth The new name column width.
	 */
	const resizeNameColumnHandler = (newNameColumnWidth: number) => {
		// Calculate the new details column width.
		const newDetailsColumnWidth = props.width - newNameColumnWidth;

		// Adjust the column widths.
		setNameColumnWidth(newNameColumnWidth);
		setDetailsColumnWidth(newDetailsColumnWidth);

		// Set the right column visibility.
		setRightColumnVisible(newDetailsColumnWidth > RIGHT_COLUMN_VISIBILITY_THRESHOLD);
	};

	/**
	 * onSelected event handler.
	 * @param index The index of the entry that was selected.
	 */
	const selectedHandler = (index: number) => {
		const entry = variableEntries[index];
		setSelectedId(entry.id);
		outerRef.current.focus();
	};

	/**
	 * onDeselected event handler.
	 */
	const deselectedHandler = () => {
		setSelectedId(undefined);
		outerRef.current.focus();
	};

	/**
	 * onToggleExpandCollapse event handler.
	 * @param index The index of the entry that was selected.
	 */
	const toggleExpandCollapseHandler = (index: number) => {
		const selectedEntry = variableEntries[index];
		if (isVariableGroup(selectedEntry)) {
			if (selectedEntry.expanded) {
				props.positronVariablesInstance.collapseVariableGroup(
					selectedEntry.id
				);
			} else {
				props.positronVariablesInstance.expandVariableGroup(
					selectedEntry.id
				);
			}
		} else if (isVariableItem(selectedEntry) && selectedEntry.hasChildren) {
			if (selectedEntry.expanded) {
				props.positronVariablesInstance.collapseVariableItem(
					selectedEntry.path
				);
			} else {
				props.positronVariablesInstance.expandVariableItem(
					selectedEntry.path
				);
			}
		}
	};

	/**
	 * onFocus event handler.
	 */
	const focusHandler = () => {
		setFocused(true);
		positronVariablesContext.reactComponentContainer.focusChanged?.(true);
	};

	/**
	 * onBlur event handler.
	 */
	const blurHandler = () => {
		setFocused(false);
		positronVariablesContext.reactComponentContainer.focusChanged?.(false);
	};

	// workaround for web disabling scrolling on the window to prevent URL navigation
	const wheelHandler = (e: React.WheelEvent<HTMLDivElement>) => {
		if (!isWeb) {
			return;
		}

		innerRef.current.parentElement?.scrollBy(e.deltaX, e.deltaY);
	};

	/**
	 * VariableEntry component.
	 * @param index The index of the variable entry.
	 * @param style The style (positioning) at which to render the variable entry.
	 * @returns The rendered variable entry.
	 */
	const VariableEntry = ({ index, style }: ListChildComponentProps<VariableEntry>) => {
		// Get the entry being rendered.
		const entry = variableEntries[index];
		if (isVariableGroup(entry)) {
			return (
				<VariableGroup
					key={entry.id}
					variableGroup={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onToggleExpandCollapse={() => toggleExpandCollapseHandler(index)}
					positronVariablesInstance={props.positronVariablesInstance}
				/>
			);
		} else if (isVariableItem(entry)) {
			return (
				<VariableItem
					key={entry.id}
					disabled={clientState === RuntimeClientState.Closed}
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					rightColumnVisible={rightColumnVisible}
					variableItem={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onToggleExpandCollapse={() => toggleExpandCollapseHandler(index)}
					onBeginResizeNameColumn={beginResizeNameColumnHandler}
					onResizeNameColumn={resizeNameColumnHandler}
					positronVariablesInstance={props.positronVariablesInstance}
				/>
			);
		} else if (isVariableOverflow(entry)) {
			return (
				<VariableOverflow
					key={entry.id}
					nameColumnWidth={nameColumnWidth}
					detailsColumnWidth={detailsColumnWidth}
					variableOverflow={entry}
					style={style}
					focused={focused}
					selected={selectedId === entry.id}
					onSelected={() => selectedHandler(index)}
					onDeselected={deselectedHandler}
					onBeginResizeNameColumn={beginResizeNameColumnHandler}
					onResizeNameColumn={resizeNameColumnHandler}
				/>
			);
		} else {
			// It's a bug to get here.
			return null;
		}
	};

	// Render.
	return (
		<div
			ref={outerRef}
			className={'variables-instance state-' + clientState}
			style={{ width: props.width, height: props.height, zIndex: props.active ? 1 : -1 }}
			tabIndex={0}
			onKeyDown={keyDownHandler}
			onFocus={focusHandler}
			onBlur={blurHandler}
			onWheel={wheelHandler}
		>
			{!variableEntries.length ?
				<VariablesEmpty initializing={initializing} /> :
				<List
					className='list'
					ref={listRef}
					innerRef={innerRef}
					itemCount={variableEntries.length}
					// Use a custom item key instead of index.
					itemKey={index => variableEntries[index].id}
					width={props.width}
					height={props.height}
					itemSize={LINE_HEIGHT}
					overscanCount={10}
					onScroll={({ scrollOffset }) => {
						// Save the scroll offset when we're active and scrolled.
						if (props.active) {
							setScrollOffset(scrollOffset);
						}
					}}
				>
					{VariableEntry}
				</List>
			}
		</div>
	);
};
