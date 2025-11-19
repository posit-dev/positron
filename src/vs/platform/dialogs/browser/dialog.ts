/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventHelper } from '../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { IDialogOptions } from '../../../base/browser/ui/dialog/dialog.js';
import { fromNow } from '../../../base/common/date.js';
import { localize } from '../../../nls.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { ResultKind } from '../../keybinding/common/keybindingResolver.js';
import { ILayoutService } from '../../layout/browser/layoutService.js';
import { IProductService } from '../../product/common/productService.js';
import { defaultButtonStyles, defaultCheckboxStyles, defaultInputBoxStyles, defaultDialogStyles } from '../../theme/browser/defaultStyles.js';

const defaultDialogAllowableCommands = [
	'workbench.action.quit',
	'workbench.action.reloadWindow',
	'copy',
	'cut',
	'editor.action.selectAll',
	'editor.action.clipboardCopyAction',
	'editor.action.clipboardCutAction',
	'editor.action.clipboardPasteAction'
];

export function createWorkbenchDialogOptions(options: Partial<IDialogOptions>, keybindingService: IKeybindingService, layoutService: ILayoutService, allowableCommands = defaultDialogAllowableCommands): IDialogOptions {
	return {
		keyEventProcessor: (event: StandardKeyboardEvent) => {
			const resolved = keybindingService.softDispatch(event, layoutService.activeContainer);
			if (resolved.kind === ResultKind.KbFound && resolved.commandId) {
				if (!allowableCommands.includes(resolved.commandId)) {
					EventHelper.stop(event, true);
				}
			}
		},
		buttonStyles: defaultButtonStyles,
		checkboxStyles: defaultCheckboxStyles,
		inputBoxStyles: defaultInputBoxStyles,
		dialogStyles: defaultDialogStyles,
		...options
	};
}

export function createBrowserAboutDialogDetails(productService: IProductService): { title: string; details: string; detailsToCopy: string } {
	const detailString = (useAgo: boolean): string => {
		return localize('aboutDetail',
			// --- Start Positron ---
			"{0} Version: {1} build {2}\nCode - OSS Version: {3}\nCommit: {4}\nDate: {5}\nBrowser: {6}",
			productService.nameLong,
			productService.positronVersion,
			productService.positronBuildNumber,
			// --- End Positron ---
			productService.version || 'Unknown',
			productService.commit || 'Unknown',
			productService.date ? `${productService.date}${useAgo ? ' (' + fromNow(new Date(productService.date), true) + ')' : ''}` : 'Unknown',
			navigator.userAgent
		);
	};

	const details = detailString(true);
	const detailsToCopy = detailString(false);

	// --- Start Positron ---
	// We could adjust the product name to say "Positron Pro" for Workbench builds
	const aboutProductHeader = localize({ key: 'aboutProductHeader', comment: ['Header for the about dialog'] },
		"{0} by {1}",
		productService.nameLong,
		productService.companyName
	);
	// --- End Positron ---

	return {
		// --- Start Positron ---
		/*
		title: productService.nameLong,
		*/
		title: aboutProductHeader,
		// --- End Positron ---
		details: details,
		detailsToCopy: detailsToCopy
	};
}

