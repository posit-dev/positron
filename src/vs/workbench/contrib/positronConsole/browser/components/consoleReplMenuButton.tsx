/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

/**
 * ConsoleReplMenuButton component.
 * @returns The rendered component.
 */
export const ConsoleReplMenuButton = () => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available console repl instances.
		const actions: IAction[] = [];
		positronConsoleContext.consoleReplInstances.map(consoleReplInstance => {
			actions.push({
				id: consoleReplInstance.replInstance.runtime.metadata.id,
				label: consoleReplInstance.displayName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					//positronConsoleContext.languageRuntimeService.activeRuntime = languageEnvironment.runtime;
					positronConsoleContext.setCurrentConsoleReplInstance(consoleReplInstance);
				}
			});
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			text={positronConsoleContext.currentConsoleReplInstance?.displayName ?? 'None'}
			actions={actions}
		/>
	);
};
