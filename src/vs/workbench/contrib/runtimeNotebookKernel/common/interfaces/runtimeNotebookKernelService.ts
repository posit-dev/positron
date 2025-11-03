/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { URI } from '../../../../../base/common/uri.js';
import { INotebookLanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

// Create the decorator for the service (used in dependency injection).
export const IRuntimeNotebookKernelService = createDecorator<IRuntimeNotebookKernelService>('runtimeNotebookKernelService');

export interface IRuntimeNotebookKernelService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the service.
	 */
	initialize(): void;

	/**
	 * Event that is fired when code executes in any notebook.
	 */
	onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent>;

	/**
	 * Ensure that a language runtime session is started for a notebook.
	 * @param notebookUri The URI of the notebook
	 * @param source The source of the action for debugging purposes
	 */
	ensureSessionStarted(notebookUri: URI, source: string): Promise<INotebookLanguageRuntimeSession>;
}
