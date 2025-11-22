/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import * as nls from '../../../../../nls.js';

interface LanguageFilterMenuButtonProps {
	readonly currentLanguage: string | undefined;
	readonly availableLanguages: string[];
	readonly onSelectLanguage: (languageId: string) => void;
}

const filterTooltip = nls.localize('positron.historyLanguageFilter', "Filter history by language");

/**
 * LanguageFilterMenuButton component - dropdown to select which language's history to display
 */
export const LanguageFilterMenuButton = (props: LanguageFilterMenuButtonProps) => {
	const { currentLanguage, availableLanguages, onSelectLanguage } = props;

	// Build the actions for the dropdown - memoized to avoid recreating on every render
	const actions = React.useCallback((): IAction[] => {
		const actionList: IAction[] = [];

		// Add an option for each available language
		availableLanguages.forEach(languageId => {
			actionList.push({
				id: `language-${languageId}`,
				label: languageId.charAt(0).toUpperCase() + languageId.slice(1),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: currentLanguage === languageId,
				run: () => {
					onSelectLanguage(languageId);
				}
			});
		});

		return actionList;
	}, [availableLanguages, currentLanguage, onSelectLanguage]);

	// Display current language or "No Runtime" if none selected
	const displayText = currentLanguage
		? currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1)
		: nls.localize('positron.historyNoRuntime', "No Runtime");

	return (
		<ActionBarMenuButton
			actions={actions}
			align='left'
			ariaLabel={filterTooltip}
			icon={Codicon.filter}
			label={displayText}
			tooltip={filterTooltip}
		/>
	);
};
