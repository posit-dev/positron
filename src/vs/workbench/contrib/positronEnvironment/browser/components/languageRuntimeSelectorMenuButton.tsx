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
		const actions: IAction[] = [];
		positronEnvironmentContext.languageEnvironments.map(languageEnvironment => {
			actions.push({
				id: languageEnvironment.identifier,
				label: languageEnvironment.displayName,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					positronEnvironmentContext.setCurrentLanguageEnvironment(languageEnvironment);
				}
			});
		});

		if (actions.length) {
			actions.push(new Separator());
		}

		actions.push({
			id: '00000000-0000-0000-0000-000000000000',
			label: 'None',
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => {
				positronEnvironmentContext.setCurrentLanguageEnvironment(undefined);
			}
		});

		return actions;
	};

	console.log('Rendering LanguageRuntimeSelectorMenuButton');

	// Render.
	return (
		<ActionBarMenuButton
			text={positronEnvironmentContext.currentLanguageEnvironment?.displayName ?? 'None'}
			actions={actions}
		/>
	);
};
