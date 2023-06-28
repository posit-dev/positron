/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreview';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';

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
	readonly previewWebviews: PreviewWebview[];
}

/**
 * The usePositronPreviewState custom hook.
 * @returns The hook.
 */
export const usePositronPreviewState = (services: PositronPreviewServices): PositronPreviewState => {

	// Hooks.

	// Initial set of preview items.
	const [previewWebviews, setPreviewWebviews] = useState<PreviewWebview[]>(
		services.positronPreviewService.previewWebviews);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Listen for new preview pane items
		disposableStore.add(services.positronPreviewService.onDidCreatePreviewWebview(item => {
			// Add the plot instance to the list of plot instances
			setPreviewWebviews(previewItems => {
				return [item, ...previewItems];
			});
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	return { ...services, previewWebviews };
};
