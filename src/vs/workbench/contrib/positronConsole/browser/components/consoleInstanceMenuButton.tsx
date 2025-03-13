/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstanceMenuButton.css';

// React.
import React from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

// ConsoleInstanceMenuButtonProps interface.
interface ConsoleInstanceMenuButtonProps {
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * ConsoleInstanceMenuButton component.
 * @param props A ConsoleInstanceMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInstanceMenuButton = (props: ConsoleInstanceMenuButtonProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Helper method to calculate the label for a runtime session.
	const labelForSession = (session?: IRuntimeSessionMetadata): string => {
		if (session) {
			return session.sessionName;
		}
		return 'None';
	};

	// State.
	const [activeRuntimeLabel, setActiveRuntimeLabel] =
		React.useState(labelForSession(
			positronConsoleContext.activePositronConsoleInstance?.sessionMetadata));

	// useEffect hook to update the runtime label when the environment changes.
	React.useEffect(() => {
		const disposables = new DisposableStore();
		const consoleService = positronConsoleContext.positronConsoleService;
		disposables.add(consoleService.onDidChangeActivePositronConsoleInstance(e => {
			setActiveRuntimeLabel(labelForSession(e?.sessionMetadata));
		}));
		return () => disposables.dispose();
	}, [positronConsoleContext.activePositronConsoleInstance, positronConsoleContext.positronConsoleService]);

	// Switch to the given console.
	const switchToConsole = (positronConsoleInstance: IPositronConsoleInstance) => {
		const session = positronConsoleInstance.attachedRuntimeSession;
		if (session) {
			// For attached sessions, we need to set the foreground session.
			positronConsoleContext.runtimeSessionService.foregroundSession = session;
		} else {
			// For detached sessions, set the session in just the console service.
			positronConsoleContext.positronConsoleService.setActivePositronConsoleSession(positronConsoleInstance.sessionId);
		}
		setTimeout(() => {
			props.reactComponentContainer.takeFocus();
		}, 0);
	}

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available console repl instances.
		const actions: IAction[] = [];
		positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance => {
			actions.push({
				id: positronConsoleInstance.sessionId,
				label: positronConsoleInstance.sessionMetadata.sessionName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					switchToConsole(positronConsoleInstance);
				}
			});
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			actions={actions}
			text={activeRuntimeLabel}
		/>
	);
};
