/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * IToolsBarService service identifier.
 */
export const IToolsBarService = createDecorator<IToolsBarService>('toolsBarService');

/**
 * IToolsBarService interface.
 */
export interface IToolsBarService {

	readonly _serviceBrand: undefined;

	focus(): void;
}
