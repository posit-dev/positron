/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';

/**
 * PositronDataToolLayout enumeration.
 */
export enum PositronDataToolLayout {
	ColumnsLeft = 'ColumnsLeft',
	ColumnsRight = 'ColumnsRight',
	ColumnsHidden = 'ColumnsHidden',
}

/**
 * PositronDataToolServices interface.
 */
export interface PositronDataToolServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
}

/**
 * PositronDataToolState interface.
 */
export interface PositronDataToolState extends PositronDataToolServices {
	layout: PositronDataToolLayout;
	setLayout(layout: PositronDataToolLayout): void;
}

/**
 * The usePositronDataToolState custom hook.
 * @returns The hook.
 */
export const usePositronDataToolState = (services: PositronDataToolServices): PositronDataToolState => {
	// Hooks.
	const [layout, setLayout] = useState(PositronDataToolLayout.ColumnsLeft);

	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron data tool state.
	return {
		...services,
		layout,
		setLayout
	};
};
