/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';  // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { PositronActionBarServices } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { IPositronDataToolInstance } from 'vs/workbench/services/positronDataTool/browser/interfaces/positronDataToolService';

/**
 * PositronDataToolServices interface.
 */
export interface PositronDataToolServices extends PositronActionBarServices {
	readonly clipboardService: IClipboardService;
}

/**
 * PositronDataToolConfiguration interface.
 */
export interface PositronDataToolConfiguration extends PositronDataToolServices {
	readonly instance: IPositronDataToolInstance;
}

/**
 * PositronDataToolState interface.
 */
export interface PositronDataToolState extends PositronDataToolConfiguration {
}

/**
 * The usePositronDataToolState custom hook.
 * @returns The hook.
 */
export const usePositronDataToolState = (
	configuration: PositronDataToolConfiguration
): PositronDataToolState => {
	// Add event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Return the Positron data tool state.
	return {
		...configuration,
	};
};
