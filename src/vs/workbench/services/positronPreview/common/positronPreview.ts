/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const POSITRON_PREVIEW_VIEW_ID = 'workbench.panel.positronPreview';

export const POSITRON_PREVIEW_SERVICE_ID = 'positronPreviewService';

export const IPositronPreviewService = createDecorator<IPositronPreviewService>(POSITRON_PREVIEW_SERVICE_ID);

/**
 * IPositronPreviewService interface.
 */
export interface IPositronPreviewService {
	readonly _serviceBrand: undefined;
}
