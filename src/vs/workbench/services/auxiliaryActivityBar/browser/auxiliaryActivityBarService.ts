/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

/**
 * Export the service identifier.
 */
export const IAuxiliaryActivityBarService = createDecorator<IAuxiliaryActivityBarService>('auxiliaryActivityBarService');

/**
 * AuxiliaryActivityBarTopMode enumeration.
 */
export enum AuxiliaryActivityBarTopMode {
	Empty,
	Environment,
	Preview,
	Help
}

/**
 * AuxiliaryActivityBarBottomMode enumeration.
 */
export enum AuxiliaryActivityBarBottomMode {
	Empty,
	Plot,
	Viewer,
	Presentation
}

// IAuxiliaryActivityBarService interface.
export interface IAuxiliaryActivityBarService {

	readonly _serviceBrand: undefined;

	/**
	 * Top toggle methods.
	 */
	toggleEnvironmentAuxiliaryActivity(): void;
	togglePreviewAuxiliaryActivity(): void;
	toggleHelpAuxiliaryActivity(): void;

	/**
	 * Bottom toggle methods.
	 */
	togglePlotAuxiliaryActivity(): void;
	toggleViewerAuxiliaryActivity(): void;
	togglePresentationAuxiliaryActivity(): void;

	/**
	 * Top show methods.
	 */
	showEnvironmentAuxiliaryActivity(): void;
	showPreviewAuxiliaryActivity(): void;
	showHelpAuxiliaryActivity(): void;

	/**
	 * Bottom show methods.
	 */
	showPlotAuxiliaryActivity(): void;
	showViewerAuxiliaryActivity(): void;
	showPresentationAuxiliaryActivity(): void;

	/**
	 * An event that is fired when the top mode changes.
	 */
	readonly onDidChangeTopMode: Event<AuxiliaryActivityBarTopMode>;

	/**
	 * An event that is fired when the bottom mode changes.
	 */
	readonly onDidChangeBottomMode: Event<AuxiliaryActivityBarBottomMode>;

	// Other methods.

	focus(): void;
}
