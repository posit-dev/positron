/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleTabList.css';

// React.
import React, { useEffect, useRef } from 'react';

// Other dependencies.
import { ConsoleTab } from './consoleTab.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { PositronConsoleTabFocused } from '../../../../common/contextkeys.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

// ConsoleTabListProps interface.
interface ConsoleTabListProps {
	readonly width: number;
	readonly height: number;
}

export const ConsoleTabList = (props: ConsoleTabListProps) => {
	const services = usePositronReactServicesContext();
	const positronConsoleContext = usePositronConsoleContext();
	const positronConsoleTabFocusedContextKey = PositronConsoleTabFocused.bindTo(services.contextKeyService);

	const tabListRef = useRef<HTMLDivElement>(null);

	// Sort console sessions by created time, oldest to newest
	const consoleInstances = Array.from(positronConsoleContext.positronConsoleInstances.values()).sort((a, b) => {
		return a.sessionMetadata.createdTimestamp - b.sessionMetadata.createdTimestamp;
	});

	// Handles setting and resetting the tab focus context key
	useEffect(() => {
		// Capture the current tabListRef element to avoid stale ref during cleanup
		const tabListElement = tabListRef.current;
		if (!tabListElement) {
			return;
		}

		// Set up handlers to track focus of a tab element
		const handleFocus = (e: FocusEvent) => {
			// Check if the focused element is a child of tabListElement
			if (tabListElement.contains(e.target as Node)) {
				positronConsoleTabFocusedContextKey.set(true);
			}
		};

		// Setup handler to reset the context key
		const handleBlur = (e: FocusEvent) => {
			// Only reset the context key if focus is moving outside the tab list
			if (!tabListElement?.contains(e.relatedTarget as Node)) {
				positronConsoleTabFocusedContextKey.set(false);
			}
		};

		// Add event listeners to the tabListRef element
		if (tabListElement) {
			tabListElement.addEventListener('focusin', handleFocus);
			tabListElement.addEventListener('focusout', handleBlur);
		}

		// Clean up when component unmounts
		return () => {
			tabListElement.removeEventListener('focusin', handleFocus);
			tabListElement.removeEventListener('focusout', handleBlur);
			positronConsoleTabFocusedContextKey.set(false);
		};
	}, [positronConsoleTabFocusedContextKey]);

	/**
	 * Function to change the foreground session to one associated with the given console tab.
	 * This is called when a user clicks on a console tab or uses the keyboard to navigate
	 * between tabs.
	 *
	 * @param sessionId The Id of the session that should be active
	 */
	const handleChangeForegroundSession = async (sessionId: string): Promise<void> => {
		// Find the session
		const session = services.runtimeSessionService.getSession(sessionId);

		if (session) {
			// Set the session as the foreground session
			services.runtimeSessionService.foregroundSession = session;
		} else {
			// It is possible for a console instance to exist without a
			// session; this typically happens when we create a provisional
			// instance while waiting for a session to be connected, but the
			// session never connects. In this case we can't set the session as
			// the foreground session, but we can still set the console
			// instance as the active console instance.
			services.positronConsoleService.setActivePositronConsoleSession(sessionId);
		}
	};

	// Set the selected tab to the active console instance.
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!consoleInstances || consoleInstances.length === 0) {
			return;
		}

		// Find the index of the currently active console instance
		const activeIndex = consoleInstances.findIndex(instance =>
			instance.sessionId === positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId);

		// Determine the new index based on the key pressed
		let newIndex = activeIndex;
		switch (e.code) {
			case 'ArrowDown':
				e.preventDefault();
				e.stopPropagation();
				// Select the next tab if it exists, otherwise select the last tab
				newIndex = Math.min(consoleInstances.length - 1, activeIndex + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				e.stopPropagation();
				// Select the previous tab if it exists, otherwise select the first tab
				newIndex = Math.max(0, activeIndex - 1);
				break;
			case 'Home':
				e.preventDefault();
				e.stopPropagation();
				newIndex = 0;
				break;
			case 'End':
				e.preventDefault();
				e.stopPropagation();
				newIndex = consoleInstances.length - 1;
				break;
		}

		if (newIndex !== activeIndex && newIndex >= 0 && newIndex < consoleInstances.length) {
			// Get the console instance for the new index
			const consoleInstance = consoleInstances[newIndex];
			handleChangeForegroundSession(consoleInstance.sessionId).then(() => {
				// Focus the tab after it becomes active
				if (tabListRef.current) {
					const tabElements = tabListRef.current.children;
					if (tabElements && tabElements[newIndex]) {
						(tabElements[newIndex] as HTMLElement).focus();
					}
				}
			});
		}
	};

	// Render.
	return (
		<div
			ref={tabListRef}
			aria-orientation='vertical'
			className='tabs-container'
			role='tablist'
			style={{ height: props.height, width: props.width }}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			{consoleInstances.map((positronConsoleInstance) =>
				<ConsoleTab
					key={positronConsoleInstance.sessionId}
					positronConsoleInstance={positronConsoleInstance}
					width={props.width}
					onChangeSession={() => handleChangeForegroundSession(positronConsoleInstance.sessionId)}
				/>
			)}
		</div>
	);
};
