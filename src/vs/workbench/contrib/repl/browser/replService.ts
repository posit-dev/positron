/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ICreateReplOptions, IReplInstance, IReplService } from 'vs/workbench/contrib/repl/browser/repl';

/**
 * The implementation of IReplService
 */
export class ReplService implements IReplService {
	private readonly _instances: Array<IReplInstance> = [];

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
		return {
			instanceId: 0
		};
	}
}
