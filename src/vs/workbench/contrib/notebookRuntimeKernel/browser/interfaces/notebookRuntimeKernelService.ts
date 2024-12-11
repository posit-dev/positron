/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

// Create the decorator for the notebook runtime kernel service (used in dependency injection).
export const INotebookRuntimeKernelService = createDecorator<INotebookRuntimeKernelService>('notebookRuntimeKernelService');

export interface INotebookRuntimeKernelService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the service.
	 */
	initialize(): void;
}
