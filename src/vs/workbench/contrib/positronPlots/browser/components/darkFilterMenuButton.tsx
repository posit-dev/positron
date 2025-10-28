/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { DarkFilter } from '../../../../services/positronPlots/common/positronPlots.js';
import * as nls from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Icon } from '../../../../../platform/action/common/action.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

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
export const DarkFilterMenuButton = () => {
	const services = usePositronReactServicesContext();
	const [darkFilterMode, setDarkFilterMode] = useState(services.positronPlotsService.darkFilterMode);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the event handler for dark filter mode changes.
		disposableStore.add(services.positronPlotsService.onDidChangeDarkFilterMode(mode => {
			setDarkFilterMode(mode);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [services.positronPlotsService]);

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

	const iconForDarkFilter = (policy: DarkFilter): Icon => {
		switch (policy) {
			case DarkFilter.On:
				return ThemeIcon.fromId('circle-large-filled');
			case DarkFilter.Off:
				return ThemeIcon.fromId('circle-large');
			case DarkFilter.Auto:
				return ThemeIcon.fromId('color-mode');
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
					services.positronPlotsService.setDarkFilterMode(mode);
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
				await services.preferencesService.openUserSettings({
					jsonEditor: false,
					query: 'plots.darkFilter,positron.plots.darkFilter'
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
			icon={iconForDarkFilter(darkFilterMode)}
			tooltip={darkFilterTooltip}
		/>
	);
};
