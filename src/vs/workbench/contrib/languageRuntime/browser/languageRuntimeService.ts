/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	/** Needed for service branding in dependency injector */
	declare readonly _serviceBrand: undefined;

	private readonly _runtimes: Map<String, INotebookKernel> = new Map();
	private readonly _activeRuntimes: Array<INotebookKernel> = new Array();

	private readonly _onDidStartRuntime = this._register(new Emitter<INotebookKernel>);
	readonly onDidStartRuntime = this._onDidStartRuntime.event;

	private _activeLanguage: string = '';

	constructor(
		@INotebookKernelService private _notebookKernelService: INotebookKernelService
	) {
		super();

		// Probably temporary: pull kernels from the notebook kernel service
		this._notebookKernelService.onDidAddKernel((e: INotebookKernel) => {
			this.registerNotebookRuntime(e.supportedLanguages[0], e);
		});
	}

	registerNotebookRuntime(language: string, kernel: INotebookKernel): void {
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

	startRuntime(id: string): void {
		const kernels = this._runtimes.values();
		for (const kernel of kernels) {
			if (kernel.id === id) {
				// TODO: this is where we start the kernel
				this._onDidStartRuntime.fire(kernel);
				this._activeRuntimes.push(kernel);
				return;
			}
		}
		throw new Error('No runtime with id ' + id + ' was found.');
	}

	getActiveRuntimes(): Array<INotebookKernel> {
		return this._activeRuntimes;
	}
}
