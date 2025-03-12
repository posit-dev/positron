/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTabList.css';

// React.
import React, { useState } from 'react';

// Other dependencies.
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { ConsoleInstanceState } from './consoleInstanceState.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { localize } from '../../../../../nls.js';


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
			await positronConsoleContext.runtimeSessionService.deleteSession(consoleInstance.session.sessionId);
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

	return (<div
		key={`tab-${positronConsoleInstance.session.sessionId}`}
		aria-label={positronConsoleInstance.session.metadata.sessionName}
		aria-labelledby={`console-panel-${positronConsoleInstance.session.sessionId}`}
		aria-selected={positronConsoleContext.activePositronConsoleInstance?.session.sessionId === positronConsoleInstance.session.sessionId}
		className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.session.sessionId === positronConsoleInstance.session.sessionId && 'tab-button--active'}`}
		data-testid={`console-tab-${positronConsoleInstance.session.sessionId}`}
		role='tab'
		onClick={() => onClick(positronConsoleInstance)}
	>
		<ConsoleInstanceState positronConsoleInstance={positronConsoleInstance} />
		<img
			className='icon'
			src={`data:image/svg+xml;base64,${positronConsoleInstance.session.runtimeMetadata.base64EncodedIconSvg}`}
		/>
		<p className='session-name'>
			{positronConsoleInstance.session.metadata.sessionName}
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
		}
	};

	const handleTabClick = (sessionId: string) => {
		onChangeForegroundSession(sessionId);
	};

	// Sort console sessions by created time, oldest to newest
	const consoleInstances = Array.from(positronConsoleContext.positronConsoleInstances.values()).sort((a, b) => {
		return a.session.metadata.createdTimestamp - b.session.metadata.createdTimestamp;
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
					key={positronConsoleInstance.session.sessionId}
					positronConsoleInstance={positronConsoleInstance}
					onClick={() => handleTabClick(positronConsoleInstance.session.sessionId)}
				/>
			)}
		</div>
	)
}
