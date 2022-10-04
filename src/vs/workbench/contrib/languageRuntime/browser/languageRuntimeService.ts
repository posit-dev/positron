/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookLanguageRuntime } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeNotebook';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * The implementation of ILanguageRuntimeService
 */
export class LanguageRuntimeService extends Disposable implements ILanguageRuntimeService {
	/** Needed for service branding in dependency injector */
	declare readonly _serviceBrand: undefined;

	private readonly _runtimes: Map<String, ILanguageRuntime> = new Map();
	private readonly _activeRuntimes: Array<ILanguageRuntime> = new Array();

	private readonly _onDidStartRuntime = this._register(new Emitter<ILanguageRuntime>);
	readonly onDidStartRuntime = this._onDidStartRuntime.event;

	private _activeLanguage: string = '';

	constructor(
		@INotebookKernelService private _notebookKernelService: INotebookKernelService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService
	) {
		super();

		// Probably temporary: pull kernels from the notebook kernel service
		this._notebookKernelService.onDidAddKernel((e: INotebookKernel) => {
			this.registerNotebookRuntime(e.supportedLanguages[0], e);
			this._logService.trace(`Added language runtime from notebook kernel service: ${e.label} (${e.id})`);
		});
	}

	registerRuntime(runtime: ILanguageRuntime): IDisposable {
		if (this._runtimes.has(runtime.metadata.language)) {
			throw new Error('A runtime for the language ' + runtime.metadata.language + ' is already registered.');
		}
		this._runtimes.set(runtime.metadata.language, runtime);
		this._logService.trace(`Added new language runtime: ${runtime.metadata.language} (${runtime.metadata.id})`);
		return toDisposable(() => {
			this._runtimes.delete(runtime.metadata.language);
		});
	}

	/**
	 * Returns the list of all registered runtimes
	 */
	getAllRuntimes(): Array<ILanguageRuntime> {
		return Array.from(this._runtimes.values());
	}

	registerNotebookRuntime(language: string, kernel: INotebookKernel): void {
		// Create a language runtime from the notebook kernel; this triggers the
		// creation of a NotebookLanguageRuntime object that wraps the kernel in
		// the ILanguageRuntime interface.
		try {
			this.registerRuntime(this._instantiationService.createInstance(
				NotebookLanguageRuntime,
				kernel));
		} catch (err) {
			this._logService.error('Error registering notebook kernel: ' + err);
		}

		// pick up the active language if we haven't set one yet
		if (this._activeLanguage === '') {
			this._activeLanguage = language;
		}
	}

	getActiveRuntime(language: string | null): ILanguageRuntime | undefined {
		if (typeof language === 'string') {
			return this._runtimes.get(language);
		}
		return this._runtimes.get(this._activeLanguage);
	}

	setActiveRuntime(language: string): void {
		this._activeLanguage = language;
	}

	startRuntime(id: string): void {
		this._logService.trace(`Starting language runtime: '${id}'`);
		const runtimes = this._runtimes.values();
		for (const runtime of runtimes) {
			if (runtime.metadata.id === id) {
				runtime.start().then(() => {
					this._onDidStartRuntime.fire(runtime);
					this._activeRuntimes.push(runtime);
				});
				return;
			}
		}
		throw new Error(`No runtime with id '${id}' was found.`);
	}

	getActiveRuntimes(): Array<ILanguageRuntime> {
		return this._activeRuntimes;
	}
}
