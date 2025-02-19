/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTabList.css';

// React.
import React from 'react';

// Other dependencies.
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { ConsoleInstanceState } from './consoleInstanceState.js';

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

	// Sort console sessions by created time, so the most recent sessions are at the bottom
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
			{consoleInstances.map((positronConsoleInstance) => (
				<button
					key={`tab-${positronConsoleInstance.session.sessionId}`}
					aria-label={positronConsoleInstance.session.metadata.sessionName}
					aria-labelledby={`console-panel-${positronConsoleInstance.session.sessionId}`}
					aria-selected={positronConsoleContext.activePositronConsoleInstance?.session.sessionId === positronConsoleInstance.session.sessionId}
					className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.session.sessionId === positronConsoleInstance.session.sessionId && 'tab-button--active'}`}
					role='tab'
					onClick={() => handleTabClick(positronConsoleInstance.session.sessionId)}
				>
					<ConsoleInstanceState positronConsoleInstance={positronConsoleInstance} />
					<img
						className='icon'
						src={`data:image/svg+xml;base64,${positronConsoleInstance.session.runtimeMetadata.base64EncodedIconSvg}`}
					/>
					<p className='session-name'>
						{positronConsoleInstance.session.metadata.sessionName}
					</p>
				</button>
			))}
		</div>
	)
}
