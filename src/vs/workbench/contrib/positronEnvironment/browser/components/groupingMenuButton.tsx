/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./groupingMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';
import { PositronEnvironmentGrouping } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * GroupingMenuButton component.
 * @returns The rendered component.
 */
export const GroupingMenuButton = () => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// Builds the actions.
	const actions = () => {
		// This can't happen.
		if (positronEnvironmentContext.activePositronEnvironmentInstance === undefined) {
			return [];
		}

		// Get the current environment grouping.
		const environmentGrouping = positronEnvironmentContext.activePositronEnvironmentInstance.
			environmentGrouping;

		// Build the actions.
		const actions: IAction[] = [];
		actions.push({
			id: 'None',
			label: 'None',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: environmentGrouping === PositronEnvironmentGrouping.None,
			run: () => {
				if (!positronEnvironmentContext.activePositronEnvironmentInstance) {
					return;
				}

				positronEnvironmentContext.activePositronEnvironmentInstance.environmentGrouping =
					PositronEnvironmentGrouping.None;
			}
		});
		actions.push({
			id: 'Kind',
			label: 'Kind',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: environmentGrouping === PositronEnvironmentGrouping.Kind,
			run: () => {
				if (!positronEnvironmentContext.activePositronEnvironmentInstance) {
					return;
				}

				positronEnvironmentContext.activePositronEnvironmentInstance.environmentGrouping =
					PositronEnvironmentGrouping.Kind;
			}
		});
		actions.push({
			id: 'Size',
			label: 'Size',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: environmentGrouping === PositronEnvironmentGrouping.Size,
			run: () => {
				if (!positronEnvironmentContext.activePositronEnvironmentInstance) {
					return;
				}

				positronEnvironmentContext.activePositronEnvironmentInstance.environmentGrouping =
					PositronEnvironmentGrouping.Size;
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
			iconId='positron-test'
			actions={actions}
		/>
	);
};
