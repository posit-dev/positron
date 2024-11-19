/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPreviewService } from './positronPreview.js';

/**
 * PositronPreviewServices interface. Defines the set of services that are
 * required by the Positron preview pane.
 */
export interface PositronPreviewServices {
	readonly positronPreviewService: IPositronPreviewService;
}

/**
 * The Positron preview pane state.
 */
export interface PositronPreviewState extends PositronPreviewServices {
}

/**
 * The usePositronPreviewState custom hook.
 * @returns The hook.
 */
export const usePositronPreviewState = (services: PositronPreviewServices): PositronPreviewState => {

	return { ...services };

};
