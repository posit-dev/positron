/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTabList.css';

// React.
import React, { KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ConsoleInstanceState } from './consoleInstanceState.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IAction } from '../../../../../base/common/actions.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { isMacintosh } from '../../../../../base/common/platform.js';

/**
 * The minimum width required for the delete action to be displayed on the console tab.
 * The width of the tab is set to accommodate the language icon, session state,
 * session name (truncated), and the delete button.
 */
const MINIMUM_ACTION_CONSOLE_TAB_WIDTH = 110;

interface ConsoleTabProps {
	positronConsoleInstance: IPositronConsoleInstance;
	width: number; // The width of the console tab list.
	onChangeSession: (instance: IPositronConsoleInstance) => void;
}

const ConsoleTab = ({ positronConsoleInstance, width, onChangeSession }: ConsoleTabProps) => {
	// Context
	const positronConsoleContext = usePositronConsoleContext();

	// State
	const [deleteDisabled, setDeleteDisabled] = useState(false);
	const [isRenamingSession, setIsRenamingSession] = useState(false);
	const [sessionName, setSessionName] = useState(positronConsoleInstance.sessionName);

	// Refs
	const tabRef = useRef<HTMLDivElement>(null);
	const inputRef = React.useRef<HTMLInputElement>(null);

	// Variables
	const sessionId = positronConsoleInstance.sessionId;
	const isActiveTab = positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId;

	const handleClick = () => {
		// Focus the tab element so the PositronConsoleTabFocused context key
		// gets set and keyboard interactions work as expected.
		setTimeout(() => {
			if (tabRef.current) {
				tabRef.current.focus();
			}
		}, 0);

		onChangeSession(positronConsoleInstance);
	};

	const handleDeleteClick = async (e: MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();

		// Prevent the button from being clicked multiple times
		setDeleteDisabled(true);
		try {
			// Updated to support proper deletion of sessions that have
			// been shutdown or exited.
			if (positronConsoleContext.runtimeSessionService.getSession(sessionId)) {
				// Attempt to delete the session from the runtime session service.
				// This will throw an error if the session is not found.
				await positronConsoleContext.runtimeSessionService.deleteSession(sessionId);
			} else {
				// If the session is not found, it may have been deleted already
				// or is a provisional session. In this case, we can delete the
				// session from the Positron Console service.
				positronConsoleContext.positronConsoleService.deletePositronConsoleSession(sessionId);
			}
		} catch (error) {
			// Show an error notification if the session could not be deleted.
			positronConsoleContext.notificationService.error(
				localize('positronDeleteSessionError', "Failed to delete session: {0}", error)
			);
			// Re-enable the button if the session could not be deleted.
			// If it is deleted, the component is destroyed and the
			// button is no longer clickable anyway.
			setDeleteDisabled(false);
		}
	}

	/**
	 * Shows the context menu when a user right-clicks on a console instance tab.
	 * @param {number} x The x coordinate of the mouse event.
	 * @param {number} y The y coordinate of the mouse event.
	 * @returns {Promise<void>} A promise that resolves when the context menu is shown.
	 */
	const showContextMenu = async (x: number, y: number): Promise<void> => {
		// The actions that are built below.
		const actions: IAction[] = [];

		// Add the rename action
		actions.push({
			id: 'workbench.action.positronConsole.renameConsoleSession',
			label: localize('positron.console.renameInstance', "Rename..."),
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => renameConsoleSession()
		});

		// Show the context menu.
		positronConsoleContext.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	}

	const renameConsoleSession = async () => {
		// Show a prompt to rename the console session in the UI
		setIsRenamingSession(true);
		// Focus the input field after it renders and select all text
		setTimeout(() => {
			if (inputRef.current) {
				inputRef.current.focus();
				inputRef.current.select();
			}
		}, 0);
	}

	/**
	 * Submits the new session name when the user presses Enter
	 * or clicks outside the input field.
	 */
	const handleRenameSubmit = async () => {
		// Validate the new session name
		const newName = sessionName.trim();
		if (newName.length === 0 || newName === positronConsoleInstance.sessionName) {
			// Hide the input field
			setIsRenamingSession(false);
			// Restore the original session name
			setSessionName(positronConsoleInstance.sessionName);
			return;
		}

		try {
			positronConsoleContext.runtimeSessionService.updateSessionName(
				positronConsoleInstance.sessionId,
				newName
			);
			setSessionName(newName);
		} catch (error) {
			positronConsoleContext.notificationService.error(
				localize('positron.console.renameSession.error',
					"Failed to rename session {0}: {1}",
					positronConsoleInstance.sessionId,
					error
				)
			);
			setSessionName(positronConsoleInstance.sessionName);
		} finally {
			// Hide the input field
			setIsRenamingSession(false);
		}
	}

	/**
	 * The mouse down handler for the parent element of the console tab instance.
	 * This handler is used to show the context menu when the user right-clicks on a tab.
	 * @param {MouseEvent<HTMLDivElement>} e The mouse event.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLDivElement>) => {
		// Prevent the default action and stop the event from propagating.
		e.preventDefault();
		e.stopPropagation();

		// Show the context menu when the user right-clicks on a tab or
		// when the user executes ctrl + left-click on macOS
		if ((e.button === 0 && isMacintosh && e.ctrlKey) || e.button === 2) {
			showContextMenu(e.clientX, e.clientY);
		}
	}

	/**
	 * The mouse down handler for the delete button.
	 * This handler is used to prevent the context menu from showing up when the user right-clicks on the delete button.
	 * @param e The mouse event.
	 */
	const deleteButtonMouseDownHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
	}

	/**
	 * Handles keyboard events for the input field.
	 * If the user presses Enter, the new session name is submitted.
	 * If the user presses Escape, the rename operation is cancelled.
	 * Supports copy, cut, paste, and select all operations using Ctrl/Cmd + C/X/V/A.
	 * @param e The keyboard event
	 */
	const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleRenameSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			// hide the input field
			setIsRenamingSession(false);
			// restore the original session name
			setSessionName(positronConsoleInstance.sessionName);
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
			e.preventDefault();
			// Avoid triggering this action in the console instance
			e.stopPropagation();
			// Select all text in the input field
			if (inputRef.current) {
				inputRef.current.select();
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
			e.preventDefault();

			// Check if the input field has a selection
			const hasSelection = inputRef.current &&
				typeof inputRef.current.selectionStart === 'number' &&
				typeof inputRef.current.selectionEnd === 'number';

			if (hasSelection) {
				// Copy the selected text to the clipboard
				const start = inputRef.current!.selectionStart as number;
				const end = inputRef.current!.selectionEnd as number;
				const selectedText = sessionName.substring(start, end);
				positronConsoleContext.clipboardService.writeText(selectedText);

				// Remove the selected text from the input field
				const newValue = sessionName.substring(0, start) + sessionName.substring(end);
				setSessionName(newValue);
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
			e.preventDefault();

			// Check if the input field has a selection
			const hasSelection = inputRef.current &&
				typeof inputRef.current.selectionStart === 'number' &&
				typeof inputRef.current.selectionEnd === 'number';

			if (hasSelection) {
				// Copy the selected text to the clipboard
				const start = inputRef.current!.selectionStart as number;
				const end = inputRef.current!.selectionEnd as number;
				const selectedText = sessionName.substring(start, end);
				positronConsoleContext.clipboardService.writeText(selectedText);
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
			e.preventDefault();
			// Avoid triggering this action in the console instance
			e.stopPropagation();
			// Paste the text from the clipboard into the input field
			const newSessionName = await positronConsoleContext.clipboardService.readText();
			setSessionName(newSessionName);
		}
	};

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidUpdateSessionName event handler.
		disposableStore.add(
			positronConsoleContext.runtimeSessionService.onDidUpdateSessionName(session => {
				if (session.sessionId === positronConsoleInstance.sessionId) {
					setSessionName(session.dynState.sessionName);
				}
			})
		);
	}, [positronConsoleContext.runtimeSessionService, positronConsoleInstance.sessionId])


	return (
		<div
			ref={tabRef}
			aria-controls={`console-panel-${positronConsoleInstance.sessionMetadata.sessionId}`}
			aria-label={positronConsoleInstance.sessionName}
			aria-selected={positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId}
			className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId && 'tab-button--active'}`}
			data-testid={`console-tab-${positronConsoleInstance.sessionMetadata.sessionId}`}
			role='tab'
			tabIndex={isActiveTab ? 0 : -1}
			onClick={handleClick}
			onMouseDown={mouseDownHandler}
		>
			<ConsoleInstanceState positronConsoleInstance={positronConsoleInstance} />
			<img
				className='icon'
				src={`data:image/svg+xml;base64,${positronConsoleInstance.runtimeMetadata.base64EncodedIconSvg}`}
			/>
			{isRenamingSession ? (
				<input
					ref={inputRef}
					className='session-name-input'
					type='text'
					value={sessionName}
					onBlur={handleRenameSubmit}
					onChange={e => setSessionName(e.target.value)}
					onClick={e => e.stopPropagation()} // Keeps the input field open when clicked
					onKeyDown={handleKeyDown}
					onMouseDown={e => e.stopPropagation()} // Allows text selection in the input field
				/>
			) : (
				<>
					<p className='session-name'>{sessionName}</p>
					{/* Show the delete button only if the width of the tab is greater than the minimum width */
						width > MINIMUM_ACTION_CONSOLE_TAB_WIDTH &&
						<button
							className='delete-button'
							data-testid='trash-session'
							disabled={deleteDisabled}
							onClick={handleDeleteClick}
							onMouseDown={deleteButtonMouseDownHandler}
						>
							<span className='codicon codicon-trash' />
						</button>
					}
				</>
			)}
		</div>
	)
}


// ConsoleCoreProps interface.
interface ConsoleTabListProps {
	readonly width: number;
	readonly height: number;
}

export const ConsoleTabList = (props: ConsoleTabListProps) => {
	const positronConsoleContext = usePositronConsoleContext();

	const tabListRef = useRef<HTMLDivElement>(null);

	// Sort console sessions by created time, oldest to newest
	const consoleInstances = Array.from(positronConsoleContext.positronConsoleInstances.values()).sort((a, b) => {
		return a.sessionMetadata.createdTimestamp - b.sessionMetadata.createdTimestamp;
	});

	/**
	 * Function to change the active console instance that is tied to a specific session
	 *
	 * @param {string}   sessionId The Id of the session that should be active
	 */
	const handleChangeForegroundSession = async (sessionId: string): Promise<void> => {
		// Find the session
		const session =
			positronConsoleContext.runtimeSessionService.getSession(sessionId);

		if (session) {
			// Set the session as the foreground session
			positronConsoleContext.runtimeSessionService.foregroundSession = session;
		} else {
			// It is possible for a console instance to exist without a
			// session; this typically happens when we create a provisional
			// instance while waiting for a session to be connected, but the
			// session never connects. In this case we can't set the session as
			// the foreground session, but we can still set the console
			// instance as the active console instance.
			positronConsoleContext.positronConsoleService.setActivePositronConsoleSession(sessionId);
		}
	};

	// Set the selected tab to the active console instance.
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!consoleInstances || consoleInstances.length === 0) {
			return;
		}

		// Find the index of the currently active console instance
		const activeIndex = consoleInstances.findIndex(instance =>
			instance.sessionId === positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId);

		// Determine the new index based on the key pressed
		let newIndex = activeIndex;
		switch (e.code) {
			case 'ArrowDown':
				e.preventDefault();
				e.stopPropagation();
				// Select the next tab if it exists, otherwise select the last tab
				newIndex = Math.min(consoleInstances.length - 1, activeIndex + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				e.stopPropagation();
				// Select the previous tab if it exists, otherwise select the first tab
				newIndex = Math.max(0, activeIndex - 1);
				break;
			case 'Home':
				e.preventDefault();
				e.stopPropagation();
				newIndex = 0;
				break;
			case 'End':
				e.preventDefault();
				e.stopPropagation();
				newIndex = consoleInstances.length - 1;
				break;
		}

		if (newIndex !== activeIndex && newIndex >= 0 && newIndex < consoleInstances.length) {
			// Get the console instance for the new index
			const consoleInstance = consoleInstances[newIndex];
			handleChangeForegroundSession(consoleInstance.sessionId).then(() => {
				// Focus the tab after it becomes active
				if (tabListRef.current) {
					const tabElements = tabListRef.current.children;
					if (tabElements && tabElements[newIndex]) {
						(tabElements[newIndex] as HTMLElement).focus();
					}
				}
			});
		}
	};

	// Render.
	return (
		<div
			ref={tabListRef}
			aria-orientation='vertical'
			className='tabs-container'
			role='tablist'
			style={{ height: props.height, width: props.width }}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			{consoleInstances.map((positronConsoleInstance) =>
				<ConsoleTab
					key={positronConsoleInstance.sessionId}
					positronConsoleInstance={positronConsoleInstance}
					width={props.width}
					onChangeSession={() => handleChangeForegroundSession(positronConsoleInstance.sessionId)}
				/>
			)}
		</div>
	);
}
