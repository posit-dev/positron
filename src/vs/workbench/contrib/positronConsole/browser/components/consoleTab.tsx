/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTab.css';

// React.
import React, { KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { ConsoleSessionStatusIcon } from './consoleSessionStatusIcon.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IAction } from '../../../../../base/common/actions.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { RuntimeIcon } from './runtimeIcon.js';
import { getSessionDisplayName } from '../../common/sessionDisplayUtils.js';
import { ResourceUsageGraph } from './resourceUsageGraph.js';
import { ResourceUsageStats } from './resourceUsageStats.js';
import { useResourceUsageHistory } from './useResourceUsageHistory.js';

/**
 * The minimum width required for the delete action to be displayed on the console tab.
 * The width of the tab is set to accommodate the language icon, session state,
 * session name (truncated), and the delete button.
 */
const MINIMUM_ACTION_CONSOLE_TAB_WIDTH = 110;

/**
 * The height of the resource usage graph in pixels.
 */
const RESOURCE_GRAPH_HEIGHT = 24;

interface ConsoleTabProps {
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly width: number; // The width of the console tab list.
	readonly onChangeSession: (instance: IPositronConsoleInstance) => void;
}

export const ConsoleTab = ({ positronConsoleInstance, width, onChangeSession }: ConsoleTabProps) => {

	// Context
	const services = usePositronReactServicesContext();
	const positronConsoleContext = usePositronConsoleContext();

	// Compute the session display name.
	const sessionDisplayName = getSessionDisplayName({
		notebookUri: positronConsoleInstance.sessionMetadata.notebookUri,
		sessionName: positronConsoleInstance.sessionName,
	});

	// State
	const [deleteDisabled, setDeleteDisabled] = useState(false);
	const [isRenamingSession, setIsRenamingSession] = useState(false);
	const [sessionName, setSessionName] = useState(sessionDisplayName);
	const resourceUsageHistory = useResourceUsageHistory(positronConsoleInstance);
	const [consoleState, setConsoleState] = useState(positronConsoleInstance.state);
	const [showResourceMonitor, setShowResourceMonitor] = useState(
		services.configurationService.getValue<boolean>('console.showResourceMonitor') ?? true
	);

	// Refs
	const tabRef = useRef<HTMLDivElement>(null);
	const inputRef = React.useRef<HTMLInputElement>(null);

	// Variables
	const isActiveTab = positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === positronConsoleInstance.sessionId;

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add listener for showResourceMonitor configuration changes
		disposableStore.add(
			services.configurationService.onDidChangeConfiguration((e: IConfigurationChangeEvent) => {
				if (e.affectsConfiguration('console.showResourceMonitor')) {
					setShowResourceMonitor(
						services.configurationService.getValue<boolean>('console.showResourceMonitor') ?? true
					);
				}
			})
		);

		// Add the onDidUpdateSessionName event handler.
		disposableStore.add(
			services.runtimeSessionService.onDidUpdateSessionName(session => {
				if (session.sessionId === positronConsoleInstance.sessionId) {
					setSessionName(getSessionDisplayName({
						notebookUri: session.dynState.currentNotebookUri,
						sessionName: session.dynState.sessionName,
					}));
				}
			})
		);

		// Add the onDidChangeState event handler.
		disposableStore.add(
			positronConsoleInstance.onDidChangeState(state => {
				setConsoleState(state);
			})
		);

		// Add the onDidUpdateNotebookSessionUri event handler.
		//
		// Notebook session URI changes can change what the label shows; if we
		// get one of these events for our session and there's a new label for
		// the session, pick it up.
		disposableStore.add(
			services.runtimeSessionService.onDidUpdateNotebookSessionUri(e => {
				if (e.sessionId === positronConsoleInstance.sessionId) {
					const session = services.runtimeSessionService.getActiveSession(positronConsoleInstance.sessionId);
					if (session) {
						setSessionName(getSessionDisplayName({
							notebookUri: session.session.dynState.currentNotebookUri,
							sessionName: session.session.dynState.sessionName,
						}));
					}
				}
			})
		);

		// Return cleanup function to dispose of the store when effect cleans up.
		return () => {
			disposableStore.dispose();
		};
	}, [services.configurationService, services.runtimeSessionService, positronConsoleInstance]);

	// When entering rename mode, focus the input and select its text.
	useEffect(() => {
		if (isRenamingSession && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isRenamingSession]);

	/**
	 * Handles the click event for the console tab.
	 * Changes the active console instance and focuses the tab for keyboard navigation.
	 */
	const handleClick = (e: MouseEvent<HTMLDivElement>) => {
		// Prevent the console from stealing focus from the tab element
		e.stopPropagation();

		// Change the active console instance if clicking a different tab
		if (!isActiveTab) {
			onChangeSession(positronConsoleInstance);
		}

		// Focus the tab for keyboard navigation
		setTimeout(() => {
			if (tabRef.current) {
				tabRef.current.focus();
			}
		}, 0);
	};

	/**
	 * The mouse down handler for the parent element of the console tab
	 * instance.  This handler is used to show the context menu when the user
	 * right-clicks on a tab.
	 *
	 * Notebook consoles can't be renamed, so we currently do not show a context
	 * menu for them.
	 */
	const handleMouseDown = positronConsoleInstance.sessionMetadata.sessionMode ===
		LanguageRuntimeSessionMode.Notebook ? undefined :
		(e: MouseEvent<HTMLDivElement>) => {
			// Prevent the default action and stop the event from propagating.
			e.preventDefault();
			e.stopPropagation();

			// Show the context menu when the user right-clicks on a tab or
			// when the user executes ctrl + left-click on macOS
			if ((e.button === 0 && isMacintosh && e.ctrlKey) || e.button === 2) {
				showContextMenu(e.clientX, e.clientY);
			}
		};

	/**
	 * Shows the context menu when a user right-clicks on a console instance tab.
	 * @param x The x coordinate of the mouse event.
	 * @param y The y coordinate of the mouse event.
	 * @returns A promise that resolves when the context menu is shown.
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
			run: () => showRenameInputField()
		});

		// Add the delete action
		actions.push({
			id: 'workbench.action.positronConsole.deleteConsoleSession',
			label: localize('positron.console.deleteInstance', "Delete"),
			tooltip: '',
			class: undefined,
			enabled: !deleteDisabled,
			run: () => deleteSession()
		});

		// Add the show resource monitor toggle action
		actions.push({
			id: 'workbench.action.positronConsole.toggleShowResourceMonitor',
			label: localize('positron.console.showResourceMonitor', "Show Resource Monitor"),
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: showResourceMonitor,
			run: () => {
				services.configurationService.updateValue(
					'console.showResourceMonitor',
					!showResourceMonitor
				);
			}
		});

		// Show the context menu.
		services.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	/**
	 * Shows the rename console session prompt in the UI.
	 */
	const showRenameInputField = async () => {
		// Show a prompt to rename the console session in the UI
		setIsRenamingSession(true);
	};

	/**
	 * Submits the new session name on Enter or blur.
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
			services.runtimeSessionService.updateSessionName(
				positronConsoleInstance.sessionId,
				newName
			);
			setSessionName(newName);
		} catch (error) {
			services.notificationService.error(
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
	};

	/**
	 * This function is called when the user clicks on the delete button.
	 */
	const handleDeleteClick = async (e: MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation();
		deleteSession();
	};

	/**
	 * This function attempts to delete the console instance and the accompanying session.
	 */
	const deleteSession = async () => {
		// Prevent the button from being clicked multiple times
		setDeleteDisabled(true);
		try {
			// Updated to support proper deletion of sessions that have
			// been shutdown or exited.
			if (services.runtimeSessionService.getSession(positronConsoleInstance.sessionId)) {
				// Attempt to delete the session from the runtime session service.
				// This will throw an error if the session is not found.
				await services.runtimeSessionService.deleteSession(positronConsoleInstance.sessionId);
			} else {
				// If the session is not found, it may have been deleted already
				// or is a provisional session. In this case, we can delete the
				// session from the Positron Console service.
				services.positronConsoleService.deletePositronConsoleSession(positronConsoleInstance.sessionId);
			}
		} catch (error) {
			// Show an error notification if the session could not be deleted.
			services.notificationService.error(
				localize('positronDeleteSessionError', "Failed to delete session: {0}", error.message || JSON.stringify(error))
			);
			// Re-enable the button if the session could not be deleted.
			// If it is deleted, the component is destroyed and the
			// button is no longer clickable anyway.
			setDeleteDisabled(false);
		}
	};

	/**
	 * The mouse down handler for the delete button.
	 * This handler is used to prevent the context menu from showing up
	 * when the user right-clicks on the delete button.
	 */
	const handleDeleteMouseDown = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	/**
	 * Handles the key down event for the delete button.
	 * This function is called when the user presses Enter on the delete button.
	 * This prevents the rename action from triggering which fires when Enter is
	 * pressed on the tab element.
	 */
	const handleDeleteKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			deleteSession();
		}
	};

	/**
	 * Handles keyboard events for the input field.
	 * If the user presses Enter, the new session name is submitted.
	 * If the user presses Escape, the rename operation is cancelled.
	 * Supports copy, cut, paste, and select all operations using Ctrl/Cmd + C/X/V/A.
	 */
	const handleInputKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
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
				services.clipboardService.writeText(selectedText);

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
				services.clipboardService.writeText(selectedText);
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
			e.preventDefault();
			// Avoid triggering this action in the console instance
			e.stopPropagation();
			// Paste the text from the clipboard into the input field
			const newSessionName = await services.clipboardService.readText();
			setSessionName(newSessionName);
		}
	};

	// Get the latest resource usage data point for the stats display
	const latestResourceUsage = resourceUsageHistory.length > 0
		? resourceUsageHistory[resourceUsageHistory.length - 1]
		: null;

	// Calculate the graph width (tab width minus padding)
	const graphWidth = Math.max(0, width - 20);

	return (
		<div
			ref={tabRef}
			aria-controls={`console-panel-${positronConsoleInstance.sessionMetadata.sessionId}`}
			aria-label={positronConsoleInstance.sessionName}
			aria-selected={positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === positronConsoleInstance.sessionId}
			className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === positronConsoleInstance.sessionId && 'tab-button--active'}`}
			data-testid={`console-tab-${positronConsoleInstance.sessionMetadata.sessionId}`}
			role='tab'
			tabIndex={isActiveTab ? 0 : -1}
			onClick={handleClick}
			onMouseDown={handleMouseDown}
		>
			{/* Header row with session info */}
			<div className='tab-header show-file-icons'>
				<ConsoleSessionStatusIcon positronConsoleInstance={positronConsoleInstance} />
				<RuntimeIcon
					languageId={positronConsoleInstance.runtimeMetadata.languageId}
					notebookUri={positronConsoleInstance.sessionMetadata.notebookUri}
					sessionMode={positronConsoleInstance.sessionMetadata.sessionMode}
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
						onKeyDown={handleInputKeyDown}
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
								onKeyDown={handleDeleteKeyDown}
								onMouseDown={handleDeleteMouseDown}
							>
								<span className='codicon codicon-trash' />
							</button>
						}
					</>
				)}
			</div>

			{/* Resource usage section */}
			{isActiveTab && // Only show resource usage for the active tab
				showResourceMonitor && // Only show resource usage if enabled in settings
				resourceUsageHistory.length > 0 && // Only show resource usage if we have data
				consoleState !== PositronConsoleState.Exited && // Only show resource usage if the console is not exited
				(
					<div className='resource-usage-section'>
						<ResourceUsageGraph
							data={resourceUsageHistory}
							height={RESOURCE_GRAPH_HEIGHT}
							width={graphWidth}
						/>
						{latestResourceUsage && (
							<ResourceUsageStats
								cpuPercent={latestResourceUsage.cpu_percent}
								memoryBytes={latestResourceUsage.memory_bytes}
							/>
						)}
					</div>
				)}
		</div>
	);
};
