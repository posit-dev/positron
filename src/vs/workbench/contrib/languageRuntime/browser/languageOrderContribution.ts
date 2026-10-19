/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { compareLanguages, ILanguageOrderEntry } from '../../../services/languageRuntime/common/languageOrder.js';
import { updateLanguageOrderSchema } from '../../../services/languageRuntime/common/languageOrderConfiguration.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

/** Keeps the allowed values of `interpreters.languageOrder` in step with installed languages. */
export class LanguageOrderContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
	) {
		super();
		this._update();
		this._register(this._runtimeStartupService.onDidChangeLanguageIds(() => this._update()));
	}

	private _update(): void {
		const entries: ILanguageOrderEntry[] = this._runtimeStartupService.languageIds
			.map(languageId => ({ languageId, languageName: this._languageName(languageId) }))
			.sort((a, b) => compareLanguages(a, b, []));
		updateLanguageOrderSchema(entries);
	}

	private _languageName(languageId: string): string {
		return this._languageService.getLanguageName(languageId)
			?? this._languageRuntimeService.registeredRuntimes.find(r => r.languageId === languageId)?.languageName
			?? languageId;
	}
}
