/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export class LanguageInputHistory extends Disposable {
	constructor(
		private readonly _languageId: string,
		private readonly _storageService: IStorageService) {
		super();
	}

	public attachToRuntime(runtime: ILanguageRuntime): void {
	}
}
