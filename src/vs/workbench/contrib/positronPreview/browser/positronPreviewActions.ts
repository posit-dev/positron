/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronPreviewService } from './positronPreviewSevice.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { URI } from '../../../../base/common/uri.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';

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
			category,
			metadata: {
				description: nls.localize('positronOpenUrlInViewer.description', "Open an http or https URL in the Viewer pane."),
				agentCompatible: true,
				args: [{
					name: 'url',
					isOptional: true,
					description: 'The http or https URL to open. Omit to prompt the user for a URL.',
					schema: { type: 'string' }
				}]
			}
		});
	}

	/**
	 * Runs the action.
	 *
	 * @param accessor The service accessor.
	 * @param url The URL to open; the user is prompted for one if omitted.
	 */
	async run(accessor: ServicesAccessor, url?: string) {
		// Load services from accessor
		const previewService = accessor.get(IPositronPreviewService);
		const quickInputService = accessor.get(IQuickInputService);
		const openerService = accessor.get(IOpenerService);

		// Ask the user to input a URL if none was given; don't do anything if
		// the user cancels
		if (!url) {
			url = await quickInputService.input(
				{ prompt: nls.localize('positronOpenUrlInViewer.prompt', "Enter the URL to open in the viewer") });
			if (!url) {
				return;
			}
		}

		// If there's no ://, assume http://
		if (!url.includes('://')) {
			url = `http://${url}`;
		}

		// Parse the URL and make sure it's an http or https URL; we can't load
		// other types
		let uri = URI.parse(url);
		if (uri.scheme !== 'http' && uri.scheme !== 'https') {
			throw new Error(nls.localize('positronOpenUrlInViewer.invalidScheme', "The URL '{0}' has an invalid scheme; only 'http' and 'https' are supported.", url));
		}

		// Resolve the URI so that localhost URLs work when Positron is running
		// remotely
		try {
			uri = (await openerService.resolveExternalUri(uri)).resolved;
		} catch {
			// Noop; use the original URI
		}

		const previewId = `userRequestedPreview-${PositronOpenUrlInViewerAction._previewCounter++}`;
		previewService.openUri(previewId, undefined, uri);
	}
}
