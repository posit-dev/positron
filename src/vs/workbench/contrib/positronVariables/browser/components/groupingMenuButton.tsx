/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./groupingMenuButton';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronVariablesContext } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { PositronVariablesGrouping } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesInstance';

/**
 * Localized strings.
 */
const positronChangeHowVariablesAreGrouped = localize('positron.changeHowVariablesAreGrouped', "Change how variables are grouped");

/**
 * GroupingMenuButton component.
 * @returns The rendered component.
 */
export const GroupingMenuButton = () => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();

	// Builds the actions.
	const actions = () => {
		// This can't happen.
		if (positronVariablesContext.activePositronVariablesInstance === undefined) {
			return [];
		}

		// Get the current grouping.
		const grouping = positronVariablesContext.activePositronVariablesInstance.grouping;

		// Build the actions.
		const actions: IAction[] = [];

		// None.
		actions.push({
			id: 'None',
			label: 'None',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: grouping === PositronVariablesGrouping.None,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.grouping =
					PositronVariablesGrouping.None;
			}
		});

		// Separator.
		actions.push(new Separator());

		// Kind.
		actions.push({
			id: 'Kind',
			label: 'Kind',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: grouping === PositronVariablesGrouping.Kind,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.grouping =
					PositronVariablesGrouping.Kind;
			}
		});

		// Size.
		actions.push({
			id: 'Size',
			label: 'Size',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: grouping === PositronVariablesGrouping.Size,
			run: () => {
				if (!positronVariablesContext.activePositronVariablesInstance) {
					return;
				}

				positronVariablesContext.activePositronVariablesInstance.grouping =
					PositronVariablesGrouping.Size;
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
			iconId='positron-variables-grouping'
			tooltip={positronChangeHowVariablesAreGrouped}
			ariaLabel={positronChangeHowVariablesAreGrouped}
			actions={actions}
		/>
	);
};
