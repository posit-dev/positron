/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';

export const copyPlotToClipboardLabel = localize('positronCopyPlotToClipboard', "Copy Plot to Clipboard");
const copyPlotAtCustomSizeLabel = localize('positron.copyPlotAtCustomSizeMenu', "Copy Plot at Custom Size...");

/**
 * Builds the menu of the split Copy button. The first action is never checked, so the main click
 * of the split button always copies at once.
 *
 * @param copy Copies the plot at once.
 * @param copyAtCustomSize Opens the Copy Plot dialog, or undefined if the plot cannot be redrawn.
 */
export function buildCopyPlotActions(copy: () => void, copyAtCustomSize: (() => void) | undefined): IAction[] {
	const actions: IAction[] = [{
		id: 'positronPlots.copyToClipboard',
		label: copyPlotToClipboardLabel,
		tooltip: '',
		class: undefined,
		enabled: true,
		run: copy
	}];
	if (copyAtCustomSize) {
		actions.push({
			id: 'positronPlots.copyAtCustomSize',
			label: copyPlotAtCustomSizeLabel,
			tooltip: '',
			class: undefined,
			enabled: true,
			run: copyAtCustomSize
		});
	}
	return actions;
}
