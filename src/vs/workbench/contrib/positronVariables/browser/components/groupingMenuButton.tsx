/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './groupingMenuButton.css';

// React.
import React, { useState, useEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { PositronVariablesGrouping } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

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

	// State for current grouping
	const [currentGrouping, setCurrentGrouping] = useState<PositronVariablesGrouping | undefined>();

	// Subscribe to changes in entries (which happen when grouping changes)
	useEffect(() => {
		const disposableStore = new DisposableStore();

		if (positronVariablesContext.activePositronVariablesInstance) {
			// Subscribe to entries changes
			disposableStore.add(
				positronVariablesContext.activePositronVariablesInstance.onDidChangeEntries(() => {
					setCurrentGrouping(positronVariablesContext.activePositronVariablesInstance?.grouping);
				})
			);

			// Set initial value
			setCurrentGrouping(positronVariablesContext.activePositronVariablesInstance.grouping);
		}

		return () => disposableStore.dispose();
	}, [positronVariablesContext.activePositronVariablesInstance]);

	// Builds the actions.
	const actions = () => {
		// This can't happen.
		if (positronVariablesContext.activePositronVariablesInstance === undefined) {
			return [];
		}

		// Build the actions.
		const actions: IAction[] = [];

		// None.
		actions.push({
			id: 'None',
			label: 'None',
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: currentGrouping === PositronVariablesGrouping.None,
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
			checked: currentGrouping === PositronVariablesGrouping.Kind,
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
			checked: currentGrouping === PositronVariablesGrouping.Size,
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
			actions={actions}
			ariaLabel={positronChangeHowVariablesAreGrouped}
			icon={ThemeIcon.fromId('positron-variables-grouping')}
			tooltip={positronChangeHowVariablesAreGrouped}
		/>
	);
};
