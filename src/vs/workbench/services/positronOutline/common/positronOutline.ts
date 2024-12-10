/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const POSITRON_OUTLINE_VIEW_ID = 'workbench.panel.positronOutline';

export const POSITRON_OUTLINE_SERVICE_ID = 'positronOutlineService';

export const IPositronOutlineService = createDecorator<IPositronOutlineService>(POSITRON_OUTLINE_SERVICE_ID);

/**
 * IPositronOutlineService interface.
 */
export interface IPositronOutlineService {
	readonly _serviceBrand: undefined;
}
