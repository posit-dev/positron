/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const POSITRON_HISTORY_VIEW_ID = 'workbench.panel.positronHistory';

export const POSITRON_HISTORY_SERVICE_ID = 'positronHistoryService';

export const IPositronHistoryService = createDecorator<IPositronHistoryService>(POSITRON_HISTORY_SERVICE_ID);

/**
 * IPositronHistoryService interface.
 */
export interface IPositronHistoryService {
	readonly _serviceBrand: undefined;
}
