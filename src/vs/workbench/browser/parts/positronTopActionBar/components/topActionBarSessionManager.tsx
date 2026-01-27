/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarSessionManager.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ActionBarCommandButton } from '../../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { localize } from '../../../../../nls.js';
import { LANGUAGE_RUNTIME_SELECT_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_SESSION_ID } from '../../../../contrib/languageRuntime/browser/languageRuntimeActions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const startSession = localize('positron.console.startSession', "Start Session");

/**
 * This component allows users to manage the foreground session.
 * - It displays the current foreground session
 * - It allows users to switch between sessions
 * - It allows the user to start a new session
 */
export const TopActionBarSessionManager = () => {
	const services = usePositronReactServicesContext();

	const [activeSession, setActiveSession] = useState<ILanguageRuntimeSession>();
	const [labelText, setLabelText] = useState<string>(activeSession?.dynState?.sessionName ?? startSession);

	// Check if there are any active console sessions to determine
	// if the active session picker or the create session picker
	// should be shown.
	const hasActiveConsoleSessions = services.runtimeSessionService.activeSessions.find(
		session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Console);
	const command = hasActiveConsoleSessions
		? LANGUAGE_RUNTIME_SELECT_SESSION_ID
		: LANGUAGE_RUNTIME_START_NEW_SESSION_ID;

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeForegroundSession event handler.
		disposableStore.add(
			services.runtimeSessionService.onDidChangeForegroundSession(session => {
				if (session?.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
					setActiveSession(
						services.runtimeSessionService.foregroundSession);
					setLabelText(session.dynState.sessionName);
				} else if (!session) {
					setActiveSession(undefined);
					setLabelText(startSession);
				}
			})
		);

		// Add the onDidUpdateSessionName event handler.
		disposableStore.add(
			services.runtimeSessionService.onDidUpdateSessionName(session => {
				if (session.sessionId === services.runtimeSessionService.foregroundSession?.sessionId) {
					setLabelText(session.dynState.sessionName);
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
			label={labelText}
			{
			...(
				activeSession
					? { iconImageSrc: `data:image/svg+xml;base64,${activeSession?.runtimeMetadata.base64EncodedIconSvg}` }
					: { iconId: 'arrow-swap' }
			)
			}
		/>
	);
}
