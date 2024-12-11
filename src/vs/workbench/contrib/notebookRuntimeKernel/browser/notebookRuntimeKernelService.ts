/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { INotebookRuntimeKernelService } from 'vs/workbench/contrib/notebookRuntimeKernel/browser/interfaces/notebookRuntimeKernelService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

class NotebookRuntimeKernelService extends Disposable implements INotebookRuntimeKernelService {
	constructor(
		@ILogService private readonly _logService: ILogService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
	) {
		super();

		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			this._logService.debug(`[NotebookRuntimeKernelService] Registered runtime: ${runtime.runtimeId}`);
		}));
	}

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the service.
	 */
	initialize(): void {
	}
}

// Register the service.
registerSingleton(
	INotebookRuntimeKernelService,
	NotebookRuntimeKernelService,
	InstantiationType.Delayed,
);
