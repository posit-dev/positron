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
import { IModelService } from '../../../../../editor/common/services/model.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ActionBarCommandButton } from '../../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { IRuntimeSessionDisplayInfo } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { localize } from '../../../../../nls.js';
import { LANGUAGE_RUNTIME_SELECT_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID } from '../../../../contrib/languageRuntime/browser/languageRuntimeActions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { isQuartoSession, QUARTO_ICON_SVG_BASE64 } from '../../../../contrib/positronConsole/browser/components/runtimeIcon.js';

const startSession = localize('positron.console.startSession', "Start Session");

/**
 * Gets the label text from session display info.
 */
const getDisplayInfoLabel = (info: IRuntimeSessionDisplayInfo | undefined, modelService: IModelService): string => {
	if (!info) {
		return startSession;
	}
	if (info.sessionMode === LanguageRuntimeSessionMode.Notebook && info.notebookUri) {
		let notebookName = basename(info.notebookUri.path);
		// For untitled Quarto documents, the URI doesn't include .qmd.
		if (!notebookName.includes('.') && isQuartoSession(info.notebookUri, modelService)) {
			notebookName = `${notebookName}.qmd`;
		}
		return `${notebookName} - ${info.sessionName}`;
	}
	return info.sessionName;
};

/**
 * Gets the session mode icon from display info. Returns either a ThemeIcon
 * or an image source string for Quarto sessions.
 */
const getDisplayInfoIcon = (info: IRuntimeSessionDisplayInfo | undefined, modelService: IModelService): { icon?: typeof Codicon.arrowSwap; iconSrc?: string } => {
	if (!info) {
		return { icon: Codicon.arrowSwap };
	}
	if (info.sessionMode === LanguageRuntimeSessionMode.Notebook) {
		if (isQuartoSession(info.notebookUri, modelService)) {
			return { iconSrc: `data:image/svg+xml;base64,${QUARTO_ICON_SVG_BASE64}` };
		}
		return { icon: Codicon.notebook };
	}
	return { icon: Codicon.positronNewConsole };
};

/**
 * This component allows users to manage the foreground session.
 * - displays the current foreground session (console or notebook)
 * - allows users to switch between console sessions
 * - allows the user to start a new console session
 */
export const TopActionBarSessionManager = () => {
	const services = usePositronReactServicesContext();

	const [labelText, setLabelText] = useState<string>(
		getDisplayInfoLabel(services.runtimeSessionService.foregroundSessionDisplayInfo, services.modelService));
	const initialIcon = getDisplayInfoIcon(services.runtimeSessionService.foregroundSessionDisplayInfo, services.modelService);
	const [sessionIcon, setSessionIcon] = useState(initialIcon.icon);
	const [sessionIconSrc, setSessionIconSrc] = useState(initialIcon.iconSrc);

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

		// Use _foregroundSessionDisplayInfo as the single source of truth for
		// the interpreter. This event should fire when the foreground session
		// changes, the session's runtime state changes, and when an exited
		// notebook session is attempted to be set as the foreground session.
		disposableStore.add(
			services.runtimeSessionService.onDidChangeForegroundSessionDisplayInfo(info => {
				setLabelText(getDisplayInfoLabel(info, services.modelService));
				const iconInfo = getDisplayInfoIcon(info, services.modelService);
				setSessionIcon(iconInfo.icon);
				setSessionIconSrc(iconInfo.iconSrc);
			})
		);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [services.runtimeSessionService, services.modelService]);

	return (
		<ActionBarCommandButton
			ariaLabel={CommandCenter.title(command)}
			border={true}
			commandId={command}
			height={24}
			{...(sessionIconSrc
				? { iconImageSrc: sessionIconSrc, iconHeight: 14, iconWidth: 14 }
				: { icon: sessionIcon }
			)}
			label={labelText}
		/>
	);
};
