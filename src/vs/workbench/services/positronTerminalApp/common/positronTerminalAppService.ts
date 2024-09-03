/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_TERMINAL_APP_ID = 'positronTerminalAppService';

export const IPositronTerminalAppService = createDecorator<IPositronTerminalAppService>(POSITRON_TERMINAL_APP_ID);

/**
 * IPositronTerminalAppService interface.
 */
export interface IPositronTerminalAppService extends IDisposable {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;
}
