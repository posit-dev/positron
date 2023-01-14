/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./languageRuntimeSelectorMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

/**
 * ConsoleSelectorMenuButton component.
 * @returns The rendered component.
 */
export const ConsoleSelectorMenuButton = () => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available language environments.
		const actions: IAction[] = [];
		positronConsoleContext.consoleInstances.map(consoleInstance => {
			actions.push({
				id: consoleInstance.replInstance.runtime.metadata.id,
				label: consoleInstance.displayName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					//positronConsoleContext.languageRuntimeService.activeRuntime = languageEnvironment.runtime;
					positronConsoleContext.setCurrentConsoleInstance(consoleInstance);
				}
			});
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			text={positronConsoleContext.currentConsoleInstance?.displayName ?? 'None'}
			actions={actions}
		/>
	);
};
