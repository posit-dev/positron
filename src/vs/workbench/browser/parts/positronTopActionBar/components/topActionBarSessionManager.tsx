/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarSessionManager.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
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
import { getSessionDisplayName, getSessionIcon, getSessionIconStyle } from '../../../../contrib/positronConsole/common/sessionDisplayUtils.js';
import { RuntimeStatus, RuntimeStatusIcon, runtimeStateToRuntimeStatus } from '../../../../contrib/positronConsole/browser/components/runtimeStatus.js';
import { Icon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

const startSession = localize('positron.console.startSession', "Start Session");

/**
 * Gets the label text from session display info, or the default start session
 * label if no session is active.
 */
const getLabel = (info: IRuntimeSessionDisplayInfo | undefined, modelService: IModelService): string => {
	if (!info) {
		return startSession;
	}
	return getSessionDisplayName(info, modelService);
};

/**
 * Gets the session mode icon from display info.
 */
const getIcon = (info: IRuntimeSessionDisplayInfo | undefined, modelService: IModelService) => {
	if (!info) {
		return Codicon.arrowSwap;
	}
	return getSessionIcon(info, modelService);
};

/**
 * Gets the runtime status from session display info.
 * Returns undefined when there is no foreground session.
 */
const getRuntimeStatus = (info: IRuntimeSessionDisplayInfo | undefined): RuntimeStatus | undefined => {
	if (!info) {
		return undefined;
	}
	return runtimeStateToRuntimeStatus[info.sessionState];
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
		getLabel(services.runtimeSessionService.foregroundSessionDisplayInfo, services.modelService));
	const [sessionIcon, setSessionIcon] = useState(
		getIcon(services.runtimeSessionService.foregroundSessionDisplayInfo, services.modelService));
	const info = services.runtimeSessionService.foregroundSessionDisplayInfo;
	const [iconStyle, setIconStyle] = useState(
		info ? getSessionIconStyle(info, services.modelService) : undefined);
	const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | undefined>(
		getRuntimeStatus(services.runtimeSessionService.foregroundSessionDisplayInfo));

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
				setLabelText(getLabel(info, services.modelService));
				setSessionIcon(getIcon(info, services.modelService));
				setIconStyle(info ? getSessionIconStyle(info, services.modelService) : undefined);
				setRuntimeStatus(getRuntimeStatus(info));
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
		>
			<div className='top-action-bar-session-manager-face'>
				{runtimeStatus !== undefined &&
					<RuntimeStatusIcon status={runtimeStatus} />
				}
				<Icon
					className={positronClassNames(
						'action-bar-button-icon',
						{ 'custom-icon-color': Boolean(iconStyle) }
					)}
					icon={sessionIcon}
					style={iconStyle}
				/>
				<div className='action-bar-button-label'>
					{labelText}
				</div>
			</div>
		</ActionBarCommandButton>
	);
};
