/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./groupingMenuButton';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { PositronEnvironmentSorting } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentInstance';

/**
 * Localized strings.
 */
const positronChangeHowObjectsAreSorted = localize('positronChangeHowObjectsAreSorted', "Change how objects are sorted");

/**
 * SortingMenuButton component.
 * @returns The rendered component.
 */
export const SortingMenuButton = () => {
	// Context hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// Builds the actions.
	const actions = () => {
		// This can't happen.
		if (positronEnvironmentContext.activePositronEnvironmentInstance === undefined) {
			return [];
		}

		// Get the current environment sorting.
		const environmentSorting = positronEnvironmentContext.activePositronEnvironmentInstance.
			sorting;

		// Build the actions.
		const actions: IAction[] = [];

		// Name.
		actions.push({
			id: 'Name',
			label: 'Name',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: environmentSorting === PositronEnvironmentSorting.Name,
			run: () => {
				if (!positronEnvironmentContext.activePositronEnvironmentInstance) {
					return;
				}

				positronEnvironmentContext.activePositronEnvironmentInstance.sorting =
					PositronEnvironmentSorting.Name;
			}
		});

		// Size.
		actions.push({
			id: 'Size',
			label: 'Size',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: environmentSorting === PositronEnvironmentSorting.Size,
			run: () => {
				if (!positronEnvironmentContext.activePositronEnvironmentInstance) {
					return;
				}

				positronEnvironmentContext.activePositronEnvironmentInstance.sorting =
					PositronEnvironmentSorting.Size;
			}
		});

		// Done. Return the actions.
		return actions;
	};

	// If there isn't an active environment instance, don't render.
	if (!positronEnvironmentContext.activePositronEnvironmentInstance) {
		return null;
	}

	// Render.
	return (
		<ActionBarMenuButton
			iconId='positron-environment-sorting'
			tooltip={positronChangeHowObjectsAreSorted}
			ariaLabel={positronChangeHowObjectsAreSorted}
			actions={actions}
		/>
	);
};
