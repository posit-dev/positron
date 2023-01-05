/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./languageRuntimeSelectorMenuButton';
import * as React from 'react';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * LanguageRuntimeSelectorMenuButton component.
 * @returns The rendered component.
 */
export const LanguageRuntimeSelectorMenuButton = () => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available language environments.
		const actions: IAction[] = [];
		positronEnvironmentContext.languageEnvironments.map(languageEnvironment => {
			actions.push({
				id: languageEnvironment.identifier,
				label: languageEnvironment.displayName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					// TODO@softwarenerd - For now, the environment is used to change the active runtime.
					positronEnvironmentContext.languageRuntimeService.activeRuntime = languageEnvironment.runtime;
					positronEnvironmentContext.setCurrentLanguageEnvironment(languageEnvironment);
				}
			});
		});

		// Add a separator.
		if (actions.length) {
			actions.push(new Separator());
		}

		// Add the None action.
		actions.push({
			id: '00000000-0000-0000-0000-000000000000',
			label: 'None',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => {
				// TODO@softwarenerd - For now, the environment is used to change the active runtime.
				positronEnvironmentContext.languageRuntimeService.activeRuntime = undefined;
				positronEnvironmentContext.setCurrentLanguageEnvironment(undefined);
			}
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			text={positronEnvironmentContext.currentLanguageEnvironment?.displayName ?? 'None'}
			actions={actions}
		/>
	);
};
