/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, IConfigurationService, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import { IEditorPane } from '../../../common/editor.js';
import { IOpenSettingsOptions, IPreferencesService } from './preferences.js';

/**
 * Where the value of a setting is set.
 */
export interface ISettingSource {
	/** The settings tab the value is set on. */
	readonly target: ConfigurationTarget.WORKSPACE | ConfigurationTarget.USER_REMOTE | ConfigurationTarget.USER_LOCAL;
	/** Whether the value is set for a language rather than for all languages. */
	readonly languageSpecific: boolean;
}

/**
 * Finds where the value of a setting is set. Language-specific values win
 * over values for all languages from any tab. Among values of the same kind,
 * workspace values win over remote user values, which win over user values.
 * Folder and application values are not considered.
 *
 * @param value The inspected setting. Inspect it with the language as the
 * override identifier to find language-specific values.
 * @param languageSpecific Whether to assume a language-specific value when
 * no tab sets one.
 * @returns Where the value is set, or the User tab if no tab sets it.
 */
export function getSettingSource<T>(value: IConfigurationValue<T>, languageSpecific: boolean): ISettingSource {
	const tabs = [
		{ target: ConfigurationTarget.WORKSPACE, inspectValue: value.workspace },
		{ target: ConfigurationTarget.USER_REMOTE, inspectValue: value.userRemote },
		{ target: ConfigurationTarget.USER_LOCAL, inspectValue: value.userLocal },
	] as const;
	for (const override of [true, false]) {
		const tab = tabs.find(({ inspectValue }) =>
			(override ? inspectValue?.override : inspectValue?.value) !== undefined);
		if (tab) {
			return { target: tab.target, languageSpecific: override };
		}
	}
	return { target: ConfigurationTarget.USER_LOCAL, languageSpecific };
}

/**
 * Opens the settings tab a setting's value comes from, showing the setting,
 * so the user sees the value that is in effect. See getSettingSource for how
 * the tab is chosen.
 *
 * @param preferencesService The preferences service.
 * @param configurationService The configuration service.
 * @param key The setting key, such as 'interpreters.startupBehavior'.
 * @param languageId The language to show the setting for, if any.
 * @param languageSpecific Whether to show the language-specific setting when
 * no tab sets a value. Ignored without a language.
 * @returns The opened editor pane.
 */
export function openSettingWhereSet(
	preferencesService: IPreferencesService,
	configurationService: IConfigurationService,
	key: string,
	languageId?: string,
	languageSpecific = false,
): Promise<IEditorPane | undefined> {
	const source = languageId ?
		getSettingSource(configurationService.inspect(key, { overrideIdentifier: languageId }), languageSpecific) :
		getSettingSource(configurationService.inspect(key), false);
	// The Settings editor uses the query. The JSON settings editor ignores it
	// and uses the setting to reveal instead.
	const options: IOpenSettingsOptions = languageId && source.languageSpecific ?
		{ query: `@lang:${languageId} ${key}`, revealSetting: { key: `[${languageId}]` } } :
		{ query: key, revealSetting: { key } };
	if (source.target === ConfigurationTarget.WORKSPACE) {
		return preferencesService.openWorkspaceSettings(options);
	} else if (source.target === ConfigurationTarget.USER_REMOTE) {
		return preferencesService.openRemoteSettings(options);
	} else {
		return preferencesService.openUserSettings(options);
	}
}
