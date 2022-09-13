/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IAuxiliaryActivityBarService = createDecorator<IAuxiliaryActivityBarService>('auxiliaryActivityBarService');

// IAuxiliaryActivityBarService interface.
export interface IAuxiliaryActivityBarService {

	readonly _serviceBrand: undefined;

	// Toggle methods.

	toggleEnvironmentAuxiliaryActivity(): void;
	togglePreviewAuxiliaryActivity(): void;
	toggleHelpAuxiliaryActivity(): void;
	togglePlotAuxiliaryActivity(): void;
	toggleViewerAuxiliaryActivity(): void;
	togglePresentationAuxiliaryActivity(): void;

	// Show methods.

	showEnvironmentAuxiliaryActivity(): void;
	showPreviewAuxiliaryActivity(): void;
	showHelpAuxiliaryActivity(): void;
	showPlotAuxiliaryActivity(): void;
	showViewerAuxiliaryActivity(): void;
	showPresentationAuxiliaryActivity(): void;

	// Other methods.

	focus(): void;
}
