/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

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
	const labelForSession = (session?: ILanguageRuntimeSession): string => {
		if (session) {
			return session.metadata.sessionName;
		}
		return 'None';
	};

	// State.
	const [activeRuntimeLabel, setActiveRuntimeLabel] =
		React.useState(labelForSession(
			positronConsoleContext.activePositronConsoleInstance?.session));

	// useEffect hook to update the runtime label when the environment changes.
	React.useEffect(() => {
		const disposables = new DisposableStore();
		const consoleService = positronConsoleContext.positronConsoleService;
		disposables.add(consoleService.onDidChangeActivePositronConsoleInstance(e => {
			setActiveRuntimeLabel(labelForSession(e?.session));
		}));
		return () => disposables.dispose();
	}, [positronConsoleContext.activePositronConsoleInstance]);

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available console repl instances.
		const actions: IAction[] = [];
		positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance => {
			actions.push({
				id: positronConsoleInstance.session.sessionId,
				label: positronConsoleInstance.session.metadata.sessionName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					positronConsoleContext.runtimeSessionService.foregroundSession =
						positronConsoleInstance.session;
					setTimeout(() => {
						props.reactComponentContainer.takeFocus();
					}, 0);
				}
			});
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			text={activeRuntimeLabel}
			actions={actions}
		/>
	);
};
