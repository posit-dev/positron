/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTabList.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ConsoleInstanceState } from './consoleInstanceState.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';


interface ConsoleTabProps {
	positronConsoleInstance: IPositronConsoleInstance;
	onClick: (instance: IPositronConsoleInstance) => void;
}

const ConsoleTab = ({ positronConsoleInstance, onClick }: ConsoleTabProps) => {
	const positronConsoleContext = usePositronConsoleContext();
	const [deleteDisabled, setDeleteDisabled] = useState(false);

	const handleTabDeleteClick = async (evt: React.MouseEvent<HTMLButtonElement, MouseEvent>, consoleInstance: IPositronConsoleInstance) => {
		evt.stopPropagation();

		// Prevent the button from being clicked multiple times
		setDeleteDisabled(true);
		try {
			if (consoleInstance.attachedRuntimeSession) {
				await positronConsoleContext.runtimeSessionService.deleteSession(
					consoleInstance.sessionId);
			} else {
				positronConsoleContext.positronConsoleService.deletePositronConsoleSession(
					consoleInstance.sessionId);
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

	const sessionId = positronConsoleInstance.sessionMetadata.sessionId;

	return (<div
		key={`tab-${sessionId}`}
		aria-label={positronConsoleInstance.sessionMetadata.sessionName}
		aria-labelledby={`console-panel-${sessionId}`}
		aria-selected={positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId}
		className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId && 'tab-button--active'}`}
		data-testid={`console-tab-${positronConsoleInstance.sessionMetadata.sessionId}`}
		role='tab'
		onClick={() => onClick(positronConsoleInstance)}
	>
		<ConsoleInstanceState positronConsoleInstance={positronConsoleInstance} />
		<img
			className='icon'
			src={`data:image/svg+xml;base64,${positronConsoleInstance.runtimeMetadata.base64EncodedIconSvg}`}
		/>
		<p className='session-name'>
			{positronConsoleInstance.sessionMetadata.sessionName}
		</p>
		<button className='delete-button' data-testid='trash-session' disabled={deleteDisabled} onClick={evt => handleTabDeleteClick(evt, positronConsoleInstance)}>
			<span className='codicon codicon-trash' />
		</button>
	</div>)
}


// ConsoleCoreProps interface.
interface ConsoleTabListProps {
	readonly width: number;
	readonly height: number;
}

export const ConsoleTabList = (props: ConsoleTabListProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	/**
	 * Function to change the active console instance that is tied to a specific session
	 *
	 * @param {string}   sessionId The Id of the session that should be active
	 */
	const onChangeForegroundSession = async (sessionId: string): Promise<void> => {
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

	const handleTabClick = (sessionId: string) => {
		onChangeForegroundSession(sessionId);
	};

	// Sort console sessions by created time, oldest to newest
	const consoleInstances = Array.from(positronConsoleContext.positronConsoleInstances.values()).sort((a, b) => {
		return a.sessionMetadata.createdTimestamp - b.sessionMetadata.createdTimestamp;
	});

	// Render.
	return (
		<div
			className='tabs-container'
			role='tablist'
			style={{ height: props.height, width: props.width }}
		>
			{consoleInstances.map((positronConsoleInstance) =>
				<ConsoleTab
					key={positronConsoleInstance.sessionId}
					positronConsoleInstance={positronConsoleInstance}
					onClick={() => handleTabClick(positronConsoleInstance.sessionId)}
				/>
			)}
		</div>
	)
}
