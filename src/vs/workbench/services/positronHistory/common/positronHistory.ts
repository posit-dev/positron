/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_HISTORY_VIEW_ID = 'workbench.panel.positronHistory';

export const POSITRON_HISTORY_SERVICE_ID = 'positronHistoryService';

export const IPositronHistoryService = createDecorator<IPositronHistoryService>(POSITRON_HISTORY_SERVICE_ID);

/**
 * IPositronHistoryService interface.
 */
export interface IPositronHistoryService {
	readonly _serviceBrand: undefined;
}
