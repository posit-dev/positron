/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { KeyboardEvent, MouseEvent, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ConsoleInstanceState } from './consoleInstanceState.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IAction } from '../../../../../base/common/actions.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { isMacintosh } from '../../../../../base/common/platform.js';

interface ConsoleTabProps {
	positronConsoleInstance: IPositronConsoleInstance;
	onClick: (instance: IPositronConsoleInstance) => void;
}

export const ConsoleTab = ({ positronConsoleInstance, onClick }: ConsoleTabProps) => {
	// Context
	const positronConsoleContext = usePositronConsoleContext();

	// State
	const [deleteDisabled, setDeleteDisabled] = useState(false);
	const [isRenamingSession, setIsRenamingSession] = useState(false);
	const [sessionName, setSessionName] = useState(positronConsoleInstance.sessionName);

	// Refs
	const inputRef = React.useRef<HTMLInputElement>(null);

	// Variables
	const sessionId = positronConsoleInstance.sessionId;

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
				localize('positronDeleteSessionError', "Failed to delete session {0}: {1}", positronConsoleInstance.sessionId, error)
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
	 * Submits the new session name when the user presses Enter or clicks outside the input field.
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
	 * @param e The keyboard event
	 */
	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleRenameSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			// hide the input field
			setIsRenamingSession(false);
			// restore the original session name
			setSessionName(positronConsoleInstance.sessionName);
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
			key={`tab-${sessionId}`}
			aria-label={positronConsoleInstance.sessionName}
			aria-labelledby={`console-panel-${sessionId}`}
			aria-selected={positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId}
			className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId && 'tab-button--active'}`}
			data-testid={`console-tab-${positronConsoleInstance.sessionMetadata.sessionId}`}
			role='tab'
			onClick={() => onClick(positronConsoleInstance)}
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
					onClick={e => e.stopPropagation()}
					onKeyDown={handleKeyDown}
				/>
			) : (
				<>
					<p className='session-name'>{sessionName}</p>
					<button
						className='delete-button'
						data-testid='trash-session'
						disabled={deleteDisabled}
						onClick={handleDeleteClick}
						onMouseDown={deleteButtonMouseDownHandler}
					>
						<span className='codicon codicon-trash' />
					</button>
				</>
			)}
		</div>
	)
}
