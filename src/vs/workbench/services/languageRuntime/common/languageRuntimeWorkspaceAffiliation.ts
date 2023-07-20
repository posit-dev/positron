/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export class LanguageRuntimeWorkspaceAffiliation {
	private readonly storageKey = 'positron.affiliatedRuntimeId';

	constructor(
		@ILanguageRuntimeService private readonly _runtimeService: ILanguageRuntimeService,
		@IStorageService private readonly _storageService: IStorageService) {
		this._runtimeService.onDidChangeActiveRuntime(this.onDidChangeActiveRuntime, this);
		this._runtimeService.onDidRegisterRuntime(this.onDidRegisterRuntime, this);
	}

	private onDidChangeActiveRuntime(runtime: ILanguageRuntime | undefined): void {
		// Ignore if we are entering a state in which no runtime is active.
		if (!runtime) {
			return;
		}

		// Save this runtime as the affiliated runtime for the current workspace.
		this._storageService.store(this.storageKeyForRuntime(runtime),
			runtime.metadata.runtimeId,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE);
	}

	private onDidRegisterRuntime(runtime: ILanguageRuntime): void {
	}

	private storageKeyForRuntime(runtime: ILanguageRuntime): string {
		return `${this.storageKey}.${runtime.metadata.languageId}`;
	}
}
