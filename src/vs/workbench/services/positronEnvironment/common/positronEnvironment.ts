/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_ENVIRONMENT_VIEW_ID = 'workbench.panel.positronEnvironment';

export const POSITRON_ENVIRONMENT_SERVICE_ID = 'positronEnvironmentService';

export const IPositronEnvironmentService = createDecorator<IPositronEnvironmentService>(POSITRON_ENVIRONMENT_SERVICE_ID);

/**
 * IPositronEnvironmentService interface.
 */
export interface IPositronEnvironmentService {
	readonly _serviceBrand: undefined;
}
