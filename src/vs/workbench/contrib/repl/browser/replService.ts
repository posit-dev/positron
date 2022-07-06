/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { ICreateReplOptions, IReplInstance, IReplService } from 'vs/workbench/contrib/repl/browser/repl';

/**
 * The implementation of IReplService
 */
export class ReplService implements IReplService {
	private readonly _instances: Array<IReplInstance> = [];
	private _maxInstanceId: number = 1;

	/**
	 * Construct a new REPL service from injected services
	 */
	constructor(
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService
	) {

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

		// Auto-generate an instance ID for this REPL
		const id = this._maxInstanceId++;

		return {
			instanceId: id,
			kernel: kernel
		};
	}
}
