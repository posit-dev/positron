/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

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
}
