/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { compareLanguages, ILanguageOrderEntry, LANGUAGE_ORDER_KEY } from '../../../services/languageRuntime/common/languageOrder.js';
import { updateLanguageOrderSchema } from '../../../services/languageRuntime/common/languageOrderConfiguration.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

/**
 * Keeps the allowed values of `interpreters.languageOrder` in step with installed languages,
 * plus any saved ones that aren't installed here (e.g. synced from another machine).
 */
export class LanguageOrderContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._update();
		this._register(this._runtimeStartupService.onDidChangeLanguageIds(() => this._update()));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(LANGUAGE_ORDER_KEY)) {
				this._update();
			}
		}));
	}

	private _update(): void {
		// Every supported language, not just those with an interpreter, so the list doesn't change as discovery runs.
		const installed = this._runtimeStartupService.languageIds;
		const installedEntries: ILanguageOrderEntry[] = installed
			.map(languageId => ({ languageId, languageName: this._languageName(languageId) }))
			.sort((a, b) => compareLanguages(a, b, []));
		const notInstalled: ILanguageOrderEntry[] = [...this._savedLanguageIds()]
			.filter(languageId => !installed.includes(languageId))
			.map(languageId => ({
				languageId,
				languageName: localize('positron.interpreters.languageOrder.notInstalled', "{0} (not installed)", this._languageName(languageId)),
			}));
		updateLanguageOrderSchema(installedEntries, notInstalled);
	}

	/** IDs saved at any scope or enforced by an admin, since the Settings editor validates each value it shows. */
	private _savedLanguageIds(): Set<string> {
		const inspected = this._configurationService.inspect<unknown>(LANGUAGE_ORDER_KEY);
		const values = [inspected.userValue, inspected.userLocalValue, inspected.userRemoteValue, inspected.workspaceValue, inspected.workspaceFolderValue, inspected.policyValue];
		return new Set(values.flatMap(value => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []));
	}

	private _languageName(languageId: string): string {
		return this._languageService.getLanguageName(languageId)
			?? this._languageRuntimeService.registeredRuntimes.find(r => r.languageId === languageId)?.languageName
			?? languageId;
	}
}
