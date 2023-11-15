/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./groupingMenuButton';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { PositronVariablesSorting } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';

/**
 * Localized strings.
 */
const positronChangeHowVariablesAreSorted = localize('positron.changeHowVariablesAreSorted', "Change how variables are sorted");

/**
 * SortingMenuButton component.
 * @returns The rendered component.
 */
export const SortingMenuButton = () => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	// Builds the actions.
	const actions = () => {
		// This can't happen.
		if (positronVariablesContext.activePositronVariablesInstance === undefined) {
			return [];
		}

		// Get the current sorting.
		const sorting = positronVariablesContext.activePositronVariablesInstance.
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
			checked: sorting === PositronVariablesSorting.Name,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.sorting =
					PositronVariablesSorting.Name;
			}
		});

		// Size.
		actions.push({
			id: 'Size',
			label: 'Size',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: sorting === PositronVariablesSorting.Size,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.sorting =
					PositronVariablesSorting.Size;
			}
		});

		// Done. Return the actions.
		return actions;
	};

	// If there isn't an active instance, don't render.
	if (!positronVariablesContext.activePositronVariablesInstance) {
		return null;
	}

	// Render.
	return (
		<ActionBarMenuButton
			iconId='positron-variables-sorting'
			tooltip={positronChangeHowVariablesAreSorted}
			ariaLabel={positronChangeHowVariablesAreSorted}
			actions={actions}
		/>
	);
};
