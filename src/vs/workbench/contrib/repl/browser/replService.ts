/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { ICreateReplOptions, IReplInstance, IReplService } from 'vs/workbench/contrib/repl/browser/repl';

/**
 * The implementation of IReplService
 */
export class ReplService extends Disposable implements IReplService {
	declare readonly _serviceBrand: undefined;

	/** Event emitted when new REPL instances are started */
	private readonly _onDidStartRepl = this._register(new Emitter<IReplInstance>);
	readonly onDidStartRepl = this._onDidStartRepl.event;

	/** The set of active REPL instances */
	private readonly _instances: Array<IReplInstance> = [];

	/** Counter for assigning unique IDs to REPL instances */
	private _maxInstanceId: number = 1;

	/**
	 * Construct a new REPL service from injected services
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService
	) {
		super();

		// When a language runtime starts, open a REPL for it if we don't
		// already have an active REPL.
		this._languageRuntimeService.onDidStartRuntime((e) => {
			if (this._instances.length === 0) {
				this.startRepl(e);
			}
		});
	}

	/**
	 * Return the current set of REPL instances
	 */
	get instances(): IReplInstance[] {
		return this._instances;
	}

	/**
	 * Creates a new REPL instance and returns it.
	 *
	 * @param options The REPL's settings
	 * @returns A promise that resolves to the newly created REPL instance.
	 */
	async createRepl(options?: ICreateReplOptions | undefined): Promise<IReplInstance> {
		const kernel = this._languageRuntimeService.getActiveRuntime(null);
		if (typeof kernel === 'undefined') {
			throw new Error('Cannot create REPL; no language runtime is active.');
		}
		return this.startRepl(kernel);
	}

	/**
	 * Starts a new REPL.
	 *
	 * @param kernel The kernel to bind to the new REPL
	 * @returns The new REPL instance
	 */
	private startRepl(kernel: INotebookKernel): IReplInstance {
		// Auto-generate an instance ID for this REPL
		const id = this._maxInstanceId++;
		const instance: IReplInstance = {
			instanceId: id,
			kernel: kernel
		};

		// Store the instance and fire event to listeners
		this._instances.push(instance);
		this._onDidStartRepl.fire(instance);
		return instance;
	}
}
