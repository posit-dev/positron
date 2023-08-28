/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { DisposableStore } from 'vs/base/common/lifecycle';

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

	// Helper method to calculate the label for a runtime.
	const labelForRuntime = (runtime?: ILanguageRuntime): string => {
		if (runtime) {
			return `${runtime.metadata.languageName} ${runtime.metadata.languageVersion}`;
		}
		return 'None';
	};

	// State.
	const [activeRuntimeLabel, setActiveRuntimeLabel] =
		React.useState(labelForRuntime(
			positronConsoleContext.activePositronConsoleInstance?.runtime));

	// useEffect hook to update the runtime label when the environment changes.
	React.useEffect(() => {
		const disposables = new DisposableStore();
		const consoleService = positronConsoleContext.positronConsoleService;
		disposables.add(consoleService.onDidChangeActivePositronConsoleInstance(e => {
			setActiveRuntimeLabel(labelForRuntime(e?.runtime));
		}));
		return () => disposables.dispose();
	}, [positronConsoleContext.activePositronConsoleInstance]);

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available console repl instances.
		const actions: IAction[] = [];
		positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance => {
			actions.push({
				id: positronConsoleInstance.runtime.metadata.runtimeId,
				label: `${positronConsoleInstance.runtime.metadata.runtimeName} ${positronConsoleInstance.runtime.metadata.languageVersion}`,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					positronConsoleContext.languageRuntimeService.activeRuntime =
						positronConsoleInstance.runtime;
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
