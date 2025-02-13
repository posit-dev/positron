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
					key={`tab-${session.sessionId}`}
					aria-label={session.metadata.sessionName}
					aria-labelledby={`console-panel-${session.sessionId}`}
					aria-selected={positronConsoleContext.activePositronConsoleInstance?.session.sessionId === session.sessionId}
					className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.session.sessionId === session.sessionId && 'tab-button--active'}`}
					role='tab'
					onClick={() => handleTabClick(session.sessionId)}
				>
					<span className='tab-button-contents'>
						<img
							className='icon'
							src={`data:image/svg+xml;base64,${session.runtimeMetadata.base64EncodedIconSvg}`}
						/>
						{session.metadata.sessionName}
					</span>

				</button>
			))}
		</div>
	)
}
