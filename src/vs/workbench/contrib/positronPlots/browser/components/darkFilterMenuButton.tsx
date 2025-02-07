/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { DarkFilter, IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import * as nls from '../../../../../nls.js';

interface DarkFilterMenuButtonProps {
	readonly plotsService: IPositronPlotsService;
}

// Labels for the menu.
const darkFilterLabel = nls.localize('positron.darkFilter', "Dark Filter");
const darkFilterNoneLabel = nls.localize('positron.darkFilterNone', "No Filter");
const darkFilterFollowThemeLabel = nls.localize('positron.darkFilterFollowTheme', "Follow Theme");

const darkFilterTooltip = nls.localize('positronDarkFilterTooltip', "Set whether a dark filter is applied to plots.");

/**
 * DarkFilterMenuButton component.
 * @param props A DarkFilterMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const DarkFilterMenuButton = (props: DarkFilterMenuButtonProps) => {

	const labelForDarkFilter = (policy: DarkFilter): string => {
		switch (policy) {
			case DarkFilter.On:
				return darkFilterLabel;
			case DarkFilter.Off:
				return darkFilterNoneLabel;
			case DarkFilter.Auto:
				return darkFilterFollowThemeLabel;
		}
	};

	// Builds the actions.
	const actions = () => {
		const modes = [DarkFilter.On,
		DarkFilter.Off,
		DarkFilter.Auto];
		const actions: IAction[] = [];
		modes.map(mode => {
			actions.push({
				id: mode,
				label: labelForDarkFilter(mode),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: props.plotsService.darkFilterMode === mode,
				run: () => {
					props.plotsService.setDarkFilterMode(mode);
				}
			});
		});

		return actions;
	};

	return (
		<ActionBarMenuButton
			iconId='light-bulb'
			tooltip={darkFilterTooltip}
			ariaLabel={darkFilterTooltip}
			align='right'
			actions={actions}
		/>
	);
};
