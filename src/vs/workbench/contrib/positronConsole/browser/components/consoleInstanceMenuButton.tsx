/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
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
	let runtimeLabel = 'None';
	const runtime = positronConsoleContext.activePositronConsoleInstance?.runtime;
	if (runtime) {
		runtimeLabel = `${runtime.metadata.languageName} ${runtime.metadata.languageVersion}`;
	}
	return (
		<ActionBarMenuButton
			text={runtimeLabel}
			actions={actions}
		/>
	);
};
