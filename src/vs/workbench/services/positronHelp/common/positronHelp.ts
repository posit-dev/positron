/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_HELP_VIEW_ID = 'workbench.panel.positronHelp';

export const POSITRON_HELP_SERVICE_ID = 'positronHelpService';

export const IPositronHelpService = createDecorator<IPositronHelpService>(POSITRON_HELP_SERVICE_ID);

/**
 *
 */
export interface IPositronHelpService {
	readonly _serviceBrand: undefined;
}

