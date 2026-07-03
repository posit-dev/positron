/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { useObservedValue } from './useObservedValue.js';
import { usePositronConfiguration } from '../../../../base/browser/positronReactHooks.js';

/**
 * Returns the paddingBlockEnd value (in pixels) needed to implement scroll-beyond-last-line
 * in the notebook cells container, matching VS Code's native notebook behavior. We rely on
 * padding to change the scrollable area because scrolling is handled by the browser in the
 * Positron Notebook Editor.
 *
 * Returns undefined when the setting is disabled so CSS controls the default bottom padding.
 */
export function useScrollBeyondLastLinePadding(
	heightObs: IObservable<number>,
): number | undefined {
	const height = useObservedValue(heightObs);
	const enabled = usePositronConfiguration('editor.scrollBeyondLastLine');
	if (!enabled) {
		return undefined;
	}
	return Math.max(0, height - 50);
}
