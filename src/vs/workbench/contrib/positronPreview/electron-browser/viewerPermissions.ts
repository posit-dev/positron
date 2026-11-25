/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Severity from '../../../../base/common/severity.js';
import { localize } from '../../../../nls.js';
import { IBrowserViewPermissionRequestEvent } from '../../../../platform/browserView/common/browserView.js';
import { PERMISSION_CATEGORY_DESCRIPTORS, PermissionDecision } from '../../../../platform/browserView/common/browserPermissions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';

/**
 * Answers a page's request for a permission by asking the user, as the
 * browser editor does. The answer lasts as long as the page's view. Requests
 * to choose a device are turned down.
 */
export async function answerPermissionRequest(dialogService: IDialogService, model: IBrowserViewModel, request: IBrowserViewPermissionRequestEvent): Promise<void> {
	if (request.device) {
		await model.selectDevice(request.device.requestId, null);
		return;
	}
	const descriptor = PERMISSION_CATEGORY_DESCRIPTORS[request.category];
	let result: PermissionDecision | undefined;
	try {
		({ result } = await dialogService.prompt<PermissionDecision>({
			type: Severity.Info,
			message: localize('positron.viewer.permissionPrompt', "{0} in the Viewer wants access to {1}", displayOrigin(request.origin), descriptor.label),
			detail: descriptor.description,
			buttons: [
				{ label: localize('positron.viewer.permissionAllow', "Allow"), run: () => 'allow' },
				{ label: localize('positron.viewer.permissionBlock', "Block"), run: () => 'deny' },
			],
			cancelButton: true,
		}));
	} finally {
		// No decision (null), as when the prompt is dismissed or can't be
		// shown, fails the page's request without remembering it.
		await model.setPermissions(request.origin, [{ category: request.category, state: result ?? null }]);
	}
}

/** The host of an origin, which is how users know a site. */
function displayOrigin(origin: string): string {
	try {
		return new URL(origin).host || origin;
	} catch {
		return origin;
	}
}
