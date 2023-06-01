/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IPositronPreviewService, IPreviewPaneItem } from 'vs/workbench/services/positronPreview/common/positronPreview';

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
	readonly previewPaneItems: IPreviewPaneItem[];
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
	const [previewPaneItems, setPreviewPaneItems] = useState<IPreviewPaneItem[]>(
		services.positronPreviewService.previewPaneItems);

	// Initial selected preview item.
	const initialSelectedId = services.positronPreviewService.activePreviewPaneItemId;
	const [selectedItemId, _setSelectedItemId] = useState<string>(initialSelectedId ?? '');

	// Index of the selected preview item.
	const initialSelectedIndex = services.positronPreviewService.previewPaneItems.findIndex
		(p => p.id === initialSelectedId);
	const [selectedItemIndex, _setSelectedItemIndex] = useState<number>(initialSelectedIndex);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		// Listen for new plot instances.
		disposableStore.add(services.positronPreviewService.onDidCreatePreviewPaneItem(item => {
			// Add the plot instance to the list of plot instances
			setPreviewPaneItems(previewItems => {
				return [item, ...previewItems];
			});
		}));


		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	return { ...services, previewPaneItems, selectedItemId, selectedItemIndex };
};
