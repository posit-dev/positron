/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentInstanceMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * EnvironmentInstanceMenuButton component.
 * @returns The rendered component.
 */
export const EnvironmentInstanceMenuButton = () => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available language environments.
		const actions: IAction[] = [];
		positronEnvironmentContext.positronEnvironmentInstances.map(positronEnvironmentInstance => {
			actions.push({
				id: positronEnvironmentInstance.runtime.metadata.runtimeId,
				label: `${positronEnvironmentInstance.runtime.metadata.runtimeName} ${positronEnvironmentInstance.runtime.metadata.languageVersion}`,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					positronEnvironmentContext.languageRuntimeService.activeRuntime =
						positronEnvironmentInstance.runtime;
				}
			});
		});

		// Done. Return the actions.
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			text={positronEnvironmentContext.activePositronEnvironmentInstance?.runtime.metadata.languageName ?? 'None'}
			actions={actions}
		/>
	);
};
