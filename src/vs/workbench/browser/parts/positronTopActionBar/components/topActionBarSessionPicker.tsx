/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarSessionPicker.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ActionBarCommandButton } from '../../../../../platform/positronActionBar/browser/components/actionBarCommandButton.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { IRuntimeSessionDisplayInfo } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { localize } from '../../../../../nls.js';
import { LANGUAGE_RUNTIME_SELECT_SESSION_ID, LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID } from '../../../../contrib/languageRuntime/browser/languageRuntimeActions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { getSessionDisplayName, runtimeStateToRuntimeStatus } from '../../../../contrib/positronConsole/common/sessionDisplayUtils.js';
import { RuntimeStatusIcon } from '../../../../contrib/positronConsole/browser/components/runtimeStatus.js';
import { RuntimeIcon } from '../../../../contrib/positronConsole/browser/components/runtimeIcon.js';
import { ActionBarButtonIcon, ActionBarButtonLabel } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';

const startSession = localize('positron.console.startSession', "Start Session");

/**
 * This component allows users to manage the foreground session.
 * - displays the current foreground session (console or notebook)
 * - allows users to switch between console sessions
 * - allows the user to start a new console session
 */
export const TopActionBarSessionPicker = () => {
	const services = usePositronReactServicesContext();

	const [displayInfo, setDisplayInfo] = useState<IRuntimeSessionDisplayInfo | undefined>(
		services.runtimeSessionService.foregroundSessionDisplayInfo);

	// Check if there are any active console sessions to determine if the
	// active session picker or the create session picker should be shown.
	const hasActiveConsoleSessions = services.runtimeSessionService.activeSessions.find(
		session => session.metadata.sessionMode === LanguageRuntimeSessionMode.Console);
	const command = hasActiveConsoleSessions
		? LANGUAGE_RUNTIME_SELECT_SESSION_ID
		: LANGUAGE_RUNTIME_START_NEW_CONSOLE_SESSION_ID;

	// Subscribe to foreground session changes. This event fires when the
	// foreground session changes, when the session's runtime state changes,
	// and when an exited notebook session is attempted to be set as the
	// foreground session.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			services.runtimeSessionService.onDidChangeForegroundSessionDisplayInfo(info => {
				setDisplayInfo(info);
			})
		);
		return () => disposableStore.dispose();
	}, [services.runtimeSessionService]);

	const labelText = displayInfo
		? getSessionDisplayName({ notebookUri: displayInfo.notebookUri, sessionName: displayInfo.sessionName })
		: startSession;
	const runtimeStatus = displayInfo ? runtimeStateToRuntimeStatus[displayInfo.sessionState] : undefined;

	return (
		<ActionBarCommandButton
			ariaLabel={CommandCenter.title(command)}
			border={true}
			commandId={command}
			height={24}
		>
			<div className='top-action-bar-session-manager-face show-file-icons'>
				{runtimeStatus !== undefined &&
					<RuntimeStatusIcon status={runtimeStatus} />
				}
				{displayInfo
					? <RuntimeIcon
						data-testid='session-manager-icon'
						languageId={displayInfo.languageId}
						notebookUri={displayInfo.notebookUri}
						sessionMode={displayInfo.sessionMode}
					/>
					: <ActionBarButtonIcon
						data-testid='session-manager-icon'
						icon={Codicon.arrowSwap}
					/>
				}
				<ActionBarButtonLabel
					hasIcon={true}
					label={labelText}
				/>
			</div>
		</ActionBarCommandButton>
	);
};
