/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

// Create the decorator for the REPL service (used in dependency injection)
export const IReplService = createDecorator<IReplService>('replService');

/**
 * The parameters needed to construct a new REPL instance
 */
export interface ICreateReplOptions {
	language?: string;
}

/**
 * An instance of a REPL bound to a language runtime.
 */
export interface IReplInstance {
	/** The REPL's instance identifier */
	readonly instanceId: number;

	/** The notebook kernel to which the instance is bound */
	readonly kernel: INotebookKernel;
}

/**
 * A service that manages a set of REPL instances.
 */
export interface IReplService {
	/** An accessor returning the set of open REPLs */
	readonly instances: readonly IReplInstance[];

	/**
	 * Creates a new REPL instance and returns it.
	 *
	 * @param options The REPL's settings.
	 */
	createRepl(options?: ICreateReplOptions): Promise<IReplInstance>;
}
