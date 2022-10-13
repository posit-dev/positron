/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * IPositronToolsSideBarService service identifier.
 */
export const IPositronToolsSideBarService = createDecorator<IPositronToolsSideBarService>('positronToolsSideBarService');

/**
 * IPositronToolsSideBarService interface.
 */
export interface IPositronToolsSideBarService {

	readonly _serviceBrand: undefined;

	focus(): void;
}
