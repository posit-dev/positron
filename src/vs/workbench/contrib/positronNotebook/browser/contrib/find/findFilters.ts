/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { derived, IObservable, observableValue } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { observableConfigValue } from '../../../../../../platform/observable/common/platformObservableUtils.js';
import { NotebookSetting } from '../../../../notebook/common/notebookCommon.js';

/**
 * Effective on/off state of each notebook find filter. Key names match the
 * properties of the `notebook.find.filters` setting.
 */
export interface IPositronNotebookFindFilterState {
	/** Match markdown cell source text while the cell's editor is shown. */
	readonly markupSource: boolean;
	/** Match markdown cell content while the cell is rendered. */
	readonly markupPreview: boolean;
	/** Match code cell source text. */
	readonly codeSource: boolean;
	/** Match the textual outputs of code cells. */
	readonly codeOutput: boolean;
}

export type PositronNotebookFindFilterKey = keyof IPositronNotebookFindFilterState;

const FILTER_KEYS: readonly PositronNotebookFindFilterKey[] = ['markupSource', 'markupPreview', 'codeSource', 'codeOutput'];

const DEFAULT_FILTER_STATE: IPositronNotebookFindFilterState = {
	markupSource: true,
	markupPreview: true,
	codeSource: true,
	codeOutput: true,
};

/**
 * Find filter state for the Positron notebook find widget.
 *
 * Defaults come from the `notebook.find.filters` setting (read live, so
 * setting changes apply immediately), and the widget's filter menu layers
 * per-session overrides on top.
 */
export class PositronNotebookFindFilters {
	/** Defaults from the notebook.find.filters setting, read live. */
	private readonly _settingState: IObservable<IPositronNotebookFindFilterState>;

	/** Per-session overrides made through the widget's filter menu. */
	private readonly _overrides = observableValue<Readonly<Partial<IPositronNotebookFindFilterState>>>('positronNotebookFindFilterOverrides', {});

	/** Effective filter state: session overrides layered over the setting. */
	readonly state: IObservable<IPositronNotebookFindFilterState>;

	/** Whether the effective state differs from the setting's defaults. */
	readonly isModified: IObservable<boolean>;

	constructor(configurationService: IConfigurationService) {
		const settingValue = observableConfigValue<Partial<IPositronNotebookFindFilterState> | undefined>(
			NotebookSetting.findFilters, undefined, configurationService);

		// Fill in missing keys of a partial setting value with the defaults.
		this._settingState = derived(reader => ({ ...DEFAULT_FILTER_STATE, ...settingValue.read(reader) }));

		this.state = derived(reader => ({ ...this._settingState.read(reader), ...this._overrides.read(reader) }));

		this.isModified = derived(reader => {
			const setting = this._settingState.read(reader);
			const state = this.state.read(reader);
			return FILTER_KEYS.some(key => setting[key] !== state[key]);
		});
	}

	/** Override a filter for the rest of the session. */
	setFilter(key: PositronNotebookFindFilterKey, value: boolean): void {
		this._overrides.set({ ...this._overrides.get(), [key]: value }, undefined);
	}
}
