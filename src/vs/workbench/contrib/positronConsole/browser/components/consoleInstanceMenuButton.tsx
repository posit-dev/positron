/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './consoleInstanceMenuButton.css';
import * as React from 'react';
import { IAction } from '../../../../../base/common/actions.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';

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
