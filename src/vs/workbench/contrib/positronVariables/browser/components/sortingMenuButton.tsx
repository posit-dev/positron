/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './groupingMenuButton.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { PositronVariablesSorting } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';

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
		const highlightRecent = positronVariablesContext.activePositronVariablesInstance.
			highlightRecent;

		// Build the actions.
		const actions: IAction[] = [];

		// Name.
		actions.push({
			id: 'Name',
			label: localize('positronVariables.sortByName', "Name"),
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
			label: localize('positronVariables.sortBySize', "Size"),
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

		// Recent.
		actions.push({
			id: 'Recent',
			label: localize('positronVariables.sortByRecent', "Recent"),
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: sorting === PositronVariablesSorting.Recent,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.sorting =
					PositronVariablesSorting.Recent;
			}
		});

		// Add a separtor between the sorting and the highlight recent actions.
		actions.push(new Separator());

		// Toggle for highlighting recent values.
		actions.push({
			id: 'Highlight Recent',
			label: localize('positronVariables.highlightRecent', "Highlight recent values"),
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: highlightRecent,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.highlightRecent =
					!highlightRecent;
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
			actions={actions}
			ariaLabel={positronChangeHowVariablesAreSorted}
			iconId='positron-variables-sorting'
			tooltip={positronChangeHowVariablesAreSorted}
		/>
	);
};
