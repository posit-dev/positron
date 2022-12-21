/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_OUTLINE_VIEW_ID = 'workbench.panel.positronOutline';

export const POSITRON_OUTLINE_SERVICE_ID = 'positronOutlineService';

export const IPositronOutlineService = createDecorator<IPositronOutlineService>(POSITRON_OUTLINE_SERVICE_ID);

/**
 * IPositronOutlineService interface.
 */
export interface IPositronOutlineService {
	readonly _serviceBrand: undefined;
}
