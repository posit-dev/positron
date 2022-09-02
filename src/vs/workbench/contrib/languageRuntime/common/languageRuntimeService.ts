/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { Event } from 'vs/base/common/event';

export const ILanguageRuntimeService = createDecorator<ILanguageRuntimeService>('ILanguageRuntimeService');

export interface ILanguageRuntimeService {
	readonly _serviceBrand: undefined;

	readonly onDidStartRuntime: Event<INotebookKernel>;

	/**
	 * @param language The language being registered
	 * @param kernel The NotebookKernel for the language; will be converted to a
	 *   LanguageRuntime
	 */
	registerNotebookRuntime(language: string, kernel: INotebookKernel): void;

	/**
	 *
	 * @param language The specific language runtime to retrieve, or `null` to
	 *   retrieve the default
	 */
	getActiveRuntime(language: string | null): INotebookKernel | undefined;

	/**
	 * Selects the active language runtime
	 *
	 * @param language The language to select
	 */
	setActiveRuntime(language: string): void;

	/**
	 * Gets the set of active runtimes
	 */
	getActiveRuntimes(): Array<INotebookKernel>;

	/**
	 * Starts a language runtime
	 *
	 * @param id The id of the runtime to start
	 */
	startRuntime(id: string): void;
}
