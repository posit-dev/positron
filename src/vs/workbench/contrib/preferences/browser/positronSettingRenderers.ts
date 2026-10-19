/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Type-only imports: settingsTree.ts imports this file, and a renderer module importing
// settingsTree.ts back would extend AbstractSettingRenderer before it is defined.
import type { IAction } from '../../../../base/common/actions.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { ISetting } from '../../../services/preferences/common/preferences.js';
import type { SettingsTarget } from './preferencesWidgets.js';
import type { AbstractSettingRenderer } from './settingsTree.js';
import type { SettingsTreeSettingElement } from './settingsTreeModels.js';

/** A Positron renderer the Settings editor uses in place of the built-in one for matching settings. */
export interface IPositronSettingRendererDescriptor {
	readonly templateId: string;
	matches(element: SettingsTreeSettingElement): boolean;
	create(
		instantiationService: IInstantiationService,
		settingActions: IAction[],
		actionFactory: (setting: ISetting, settingTarget: SettingsTarget) => IAction[]
	): AbstractSettingRenderer;
}

// Register at module load: the Settings editor reads this list once, when it is created.
export const positronSettingRenderers: IPositronSettingRendererDescriptor[] = [];
