/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { URI } from 'vs/base/common/uri';
import { INotificationService } from 'vs/platform/notification/common/notification';

export const POSITRON_PREVIEW_ACTION_CATEGORY = nls.localize('positronViewerCategory', "Viewer");
const category: ILocalizedString = { value: POSITRON_PREVIEW_ACTION_CATEGORY, original: 'Viewer' };

export class PositronOpenUrlInViewerAction extends Action2 {

	static ID = 'workbench.action.positronPreview.openUrl';

	private static _previewCounter = 0;

	constructor() {
		super({
			id: PositronOpenUrlInViewerAction.ID,
			title: nls.localize2('positronOpenUrlInViewer', "Open URL in Viewer"),
			f1: true,
			category
		});
	}

	/**
	 * Runs the action.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		// Load services from accessor
		const previewService = accessor.get(IPositronPreviewService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		// Ask the user to input a URL; don't do anything if the user cancels
		let url = await quickInputService.input(
			{ prompt: nls.localize('positronOpenUrlInViewer.prompt', "Enter the URL to open in the viewer") });
		if (!url) {
			return;
		}

		// If the user didn't enter a ://, assume they meant http://
		if (!url.includes('://')) {
			url = `http://${url}`;
		}

		// Parse the URL and open it in the viewer
		let uri: URI | undefined;
		try {
			uri = URI.parse(url);
		} catch (err) {
			// Tell the user they've made a terrible mistake
			notificationService.error(nls.localize('positronOpenUrlInViewer.invalidUrl', "The URL '{0}' is invalid: {1}", url, err));
			return;
		}

		// Make sure it's an http or https URL; we can't load other types
		if (uri.scheme !== 'http' && uri.scheme !== 'https') {
			notificationService.error(nls.localize('positronOpenUrlInViewer.invalidScheme', "The URL '{0}' has an invalid scheme; only 'http' and 'https' are supported.", url));
			return;
		}

		const previewId = `userRequestedPreview-${PositronOpenUrlInViewerAction._previewCounter++}`;
		previewService.openUri(previewId, 'origin', undefined, uri);
	}
}
