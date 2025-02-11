/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTabList.css';

// React
import React from 'react';

// Other dependencies.
import { usePositronConsoleContext } from '../positronConsoleContext.js';

// ConsoleCoreProps interface.
interface ConsoleTabListProps {
	readonly width: number;
	readonly height: number;
}

export const ConsoleTabList = (props: ConsoleTabListProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	/**
	 * activateRuntime event handler.
	 * @param runtime An ILanguageRuntime representing the runtime to activate.
	 */
	const onChangeForegroundSession = async (sessionId: string): Promise<void> => {
		// Get the desired session
		const session =
			positronConsoleContext.runtimeSessionService.getSession(sessionId);

		if (session) {
			// Set the session as the foreground session
			positronConsoleContext.runtimeSessionService.foregroundSession = session;
			// Update active console instance?
		} else {
			// TODO: Error handling - session doesn't exist
		}
	};

	// Change active session
	const handleTabClick = (sessionId: string) => {
		onChangeForegroundSession(sessionId);
	};

	// Sort console sessions by created time, so the most recent sessions are at the bottom
	const sessions = Array.from(positronConsoleContext.positronSessions.values()).sort((a, b) => {
		return a.metadata.createdTimestamp - b.metadata.createdTimestamp;
	});

	// Render.
	return (
		<div
			className='tabs-container'
			role='tablist'
			style={{ height: props.height, width: props.width }}
		>
			{sessions.map((session) => (
				<button
					aria-label={session.metadata.sessionName}
					aria-labelledby={`console-panel-${session.sessionId}`}
					aria-selected={positronConsoleContext.activePositronConsoleInstance?.session.sessionId === session.sessionId}
					className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.session.sessionId === session.sessionId && 'tab-button--active'}`}
					key={`tab-${session.sessionId}`}
					onClick={() => handleTabClick(session.sessionId)}
					role='tab'
				>
					<span>{session.getRuntimeState()}</span> - {session.metadata.sessionName}
				</button>
			))}
		</div>
	)
}
