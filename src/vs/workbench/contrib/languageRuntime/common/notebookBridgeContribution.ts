/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { NotebookLanguageRuntime } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeNotebook';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { ILanguageRuntimeService, LanguageRuntimeStartupBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILogService } from 'vs/platform/log/common/log';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';

export class NotebookBridgeContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@ILogService private readonly _logService: ILogService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@ILanguageService private readonly _languageService: ILanguageService
	) {
		super();

		// Pull kernels from the notebook kernel service as they are added.
		//
		// Note that most kernels are only added when the extension supplying
		// them is activated, so this event will fire on extension activation
		// events such as opening a file of the associated language type.
		this._register(this._notebookKernelService.onDidAddKernel((kernel: INotebookKernel) => {
			// Skip non-interactive kernels
			if (kernel.id.indexOf('Interactive') === -1) {
				return;
			}

			// Check to see whether the kernel thinks it supports every language.
			if (kernel.supportedLanguages.length === this._languageService.getRegisteredLanguageIds().length) {
				// If the kernel says that it supports every single registered
				// language, then it is lying. It just hasn't had its set of
				// registered languages populated yet (this happens
				// asynchronously).
				//
				// Wait for population to finish and then register the kernel
				// when its set of supported languages changes.
				const handler = kernel.onDidChange(e => {
					// The population is complete when the kernel's set of
					// supported languages is no longer the same as the set
					// of registered languages.
					if (e.supportedLanguages &&
						kernel.supportedLanguages.length < this._languageService.getRegisteredLanguageIds().length) {
						this._logService.debug(`Kernel ${kernel.id} changed: ${JSON.stringify(e)}`);

						// Stop listening for changes so we don't trigger a loop
						// (registering the kernel will trigger another change event
						// when we add the backing notebook)
						handler.dispose();

						// Register the notebook as a language backend
						this.registerNotebookRuntime(kernel.supportedLanguages[0], kernel);
					}
				});
			} else {
				// The kernel is already registered; add it directly
				this.registerNotebookRuntime(kernel.supportedLanguages[0], kernel);
			}
		}));
	}

	registerNotebookRuntime(language: string, kernel: INotebookKernel): void {
		// Create a language runtime from the notebook kernel; this triggers the
		// creation of a NotebookLanguageRuntime object that wraps the kernel in
		// the ILanguageRuntime interface.
		try {
			this._languageRuntimeService.registerRuntime(this._instantiationService.createInstance(
				NotebookLanguageRuntime,
				kernel),
				LanguageRuntimeStartupBehavior.Explicit);
		} catch (err) {
			this._logService.warn(`Can't register notebook kernel ${kernel.id} as a language runtime: ${err}`);
		}
	}
}
