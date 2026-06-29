/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/**
 * Describes a badge rendered next to a setting when the setting
 * carries a {@link IPositronSettingBadge.tag}. Append an entry to
 * {@link POSITRON_SETTING_BADGES} to introduce a new badge.
 */
export interface IPositronSettingBadge {
	/**
	 * Setting tag that triggers rendering of this badge. Must match a value in a
	 * setting's `tags` field to display the badge.
	 */
	readonly tag: string;
	/** Localized text shown inside the badge. */
	readonly label: string;
	/** Localized hover description explaining the badge. */
	readonly description: string;
}

/**
 * The list of setting badges that can be shown in the UI.
 * The `tag` of each badge must be unique and should match the tags used in settings tree elements
 * (`SettingsTreeSettingElement.tags`) to trigger the badge's display.
 */
export const POSITRON_SETTING_BADGES: readonly IPositronSettingBadge[] = [
	{
		tag: 'legacy',
		label: localize('positron.legacyBadge', "Legacy"),
		description: localize('positron.legacyBadgeDescription', "This setting is only supported by the legacy notebook editor."),
	},
];

/**
 * Returns the badges that should be shown for a setting carrying the given tags,
 * in registry order.
 *
 * @param tags The tag set from the setting's tree element (`SettingsTreeSettingElement.tags`).
 */
export function getActiveBadges(tags: ReadonlySet<string> | undefined): IPositronSettingBadge[] {
	if (!tags?.size) {
		return [];
	}
	return POSITRON_SETTING_BADGES.filter(badge => tags.has(badge.tag));
}
