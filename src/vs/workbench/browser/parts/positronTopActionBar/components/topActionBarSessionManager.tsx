/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarSessionManager.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { basename } from '../../../../../base/common/path.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ActionBarCommandButton } from '../../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { localize } from '../../../../../nls.js';
import { LANGUAGE_RUNTIME_SELECT_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID } from '../../../../contrib/languageRuntime/browser/languageRuntimeActions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const startSession = localize('positron.console.startSession', "Start Session");

/**
 * Gets the session mode icon for the given session.
 * @param session The session to get the icon for.
 * @returns The Codicon for the session mode.
 */
const getSessionModeIcon = (session: ILanguageRuntimeSession | undefined) => {
	if (!session) {
		return Codicon.arrowSwap;
	}
	if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
		return Codicon.notebook;
	}
	return Codicon.positronNewConsole;
};

/**
 * Gets the label text for the given session.
 * For notebook sessions, includes the notebook filename.
 * For console sessions, just shows the session name.
 * @param session The session to get the label for.
 * @returns The label text.
 */
const getSessionLabel = (session: ILanguageRuntimeSession | undefined): string => {
	if (!session) {
		return startSession;
	}
	const sessionName = session.dynState.sessionName;
	if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook && session.metadata.notebookUri) {
		const notebookName = basename(session.metadata.notebookUri.path);
		return `${notebookName} - ${sessionName}`;
	}
	return sessionName;
};

/**
 * This component allows users to manage the foreground session.
 * - displays the current foreground session (console or notebook)
 * - allows users to switch between console sessions
 * - allows the user to start a new console session
 */
export const TopActionBarSessionManager = () => {
	const services = usePositronReactServicesContext();

	const [activeSession, setActiveSession] = useState<ILanguageRuntimeSession>();
	const [labelText, setLabelText] = useState<string>(getSessionLabel(activeSession));
	const [sessionIcon, setSessionIcon] = useState(getSessionModeIcon(activeSession));

	// Check if there are any active console sessions to determine if the
	// active session picker or the create session picker should be shown.
	const hasActiveConsoleSessions = services.runtimeSessionService.activeSessions.find(
		session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Console);
	const command = hasActiveConsoleSessions
		? LANGUAGE_RUNTIME_SELECT_SESSION_ID
		: LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID;

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeForegroundSession event handler to listen for changes
		// to the foreground session and update the label, icon, and active session accordingly.
		disposableStore.add(
			services.runtimeSessionService.onDidChangeForegroundSession(session => {
				setActiveSession(session);
				setLabelText(getSessionLabel(session));
				setSessionIcon(getSessionModeIcon(session));
			})
		);

		// Add the onDidUpdateSessionName event handler to listen for changes
		// to the session name and update the label accordingly.
		disposableStore.add(
			services.runtimeSessionService.onDidUpdateSessionName(session => {
				if (session.sessionId === services.runtimeSessionService.foregroundSession?.sessionId) {
					setLabelText(getSessionLabel(session));
				}
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [services.runtimeSessionService]);

	return (
		<ActionBarCommandButton
			ariaLabel={CommandCenter.title(command)}
			border={true}
			commandId={command}
			height={24}
			icon={sessionIcon}
			label={labelText}
		/>
	);
};
