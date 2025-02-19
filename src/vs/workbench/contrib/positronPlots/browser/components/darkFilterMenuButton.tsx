/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { DarkFilter, IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import * as nls from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { localize } from '../../../../../nls.js';

interface DarkFilterMenuButtonProps {
	readonly plotsService: IPositronPlotsService;
	readonly preferencesService: IPreferencesService;
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

	const [darkFilterMode, setDarkFilterMode] = useState(props.plotsService.darkFilterMode);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the event handler for dark filter mode changes.
		disposableStore.add(props.plotsService.onDidChangeDarkFilterMode(mode => {
			setDarkFilterMode(mode);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.plotsService]);

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

	const iconForDarkFilter = (policy: DarkFilter): string => {
		switch (policy) {
			case DarkFilter.On:
				return 'circle-large-filled';
			case DarkFilter.Off:
				return 'circle-large';
			case DarkFilter.Auto:
				return 'color-mode';
		}
	}

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
				checked: darkFilterMode === mode,
				run: () => {
					props.plotsService.setDarkFilterMode(mode);
				}
			});
		});

		// Add an action to open the settings.
		actions.push({
			id: 'open-settings',
			label: localize('positron.openDarkFilterSettings', "Change Default in Settings..."),
			tooltip: '',
			class: undefined,
			enabled: true,
			run: async () => {
				await props.preferencesService.openUserSettings({
					jsonEditor: false,
					query: 'positron.plots.darkFilter'
				});
			}
		});
		return actions;
	};

	return (
		<ActionBarMenuButton
			actions={actions}
			align='right'
			ariaLabel={darkFilterTooltip}
			iconId={iconForDarkFilter(darkFilterMode)}
			tooltip={darkFilterTooltip}
		/>
	);
};
