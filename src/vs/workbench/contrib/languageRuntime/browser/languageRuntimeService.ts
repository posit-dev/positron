/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService implements ILanguageRuntimeService {
	declare readonly _serviceBrand: undefined;
	private readonly _runtimes: Map<String, INotebookKernel> = new Map();
	private _activeLanguage: string = '';

	registerRuntime(language: string, kernel: INotebookKernel): void {
		this._runtimes.set(language, kernel);

		// pick up the active language if we haven't set one yet
		if (this._activeLanguage === '') {
			this._activeLanguage = language;
		}
	}

	getActiveRuntime(language: string | null): INotebookKernel | undefined {
		if (typeof language === 'string') {
			return this._runtimes.get(language);
		}
		return this._runtimes.get(this._activeLanguage);
	}

	setActiveRuntime(language: string): void {
		this._activeLanguage = language;
	}
}
