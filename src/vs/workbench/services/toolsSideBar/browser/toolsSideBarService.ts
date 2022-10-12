/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * IToolsSideBarService service identifier.
 */
export const IToolsSideBarService = createDecorator<IToolsSideBarService>('toolsSideBarService');

/**
 * IToolsSideBarService interface.
 */
export interface IToolsSideBarService {

	readonly _serviceBrand: undefined;

	focus(): void;
}
