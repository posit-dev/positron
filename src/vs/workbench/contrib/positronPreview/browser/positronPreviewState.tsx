/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewService';
import { IPositronPreviewService } from 'vs/workbench/services/positronPreview/browser/positronPreview';

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
	selectedItemId: string;
	selectedItemIndex: number;
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

	// Initial selected preview item.
	const initialSelectedId = services.positronPreviewService.activePreviewWebviewId;
	const [selectedItemId, setSelectedItemId] = useState<string>(initialSelectedId ?? '');

	// Index of the selected preview item.
	const initialSelectedIndex = services.positronPreviewService.previewWebviews.findIndex
		(p => p.providedId === initialSelectedId);
	const [selectedItemIndex, setSelectedItemIndex] = useState<number>(initialSelectedIndex);

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

		// Listen for preview pane item updates
		disposableStore.add(services.positronPreviewService.onDidChangeActivePreviewWebview(id => {
			setSelectedItemId(id);
			setSelectedItemIndex(services.positronPreviewService.previewWebviews.findIndex(p => p.providedId === id));
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	return { ...services, previewWebviews, selectedItemId, selectedItemIndex };
};
