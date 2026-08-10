/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPositronHelpService } from '../../positronHelp/browser/positronHelpService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import {
	RuntimeCodeExecutionMode,
	RuntimeErrorBehavior,
} from '../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Open the help page for a package using the given session's language.
 *
 * R: open the package's help index directly (`help(package = ...)`); printing
 * the result triggers ark's browseURL hook, which surfaces the page in the help
 * pane. Other languages: ask the help service for the topic, falling back to a
 * notification when nothing is found.
 */
export async function showPackageHelp(
	session: ILanguageRuntimeSession,
	helpService: IPositronHelpService,
	notificationService: INotificationService,
	packageName: string,
): Promise<void> {
	const languageId = session.runtimeMetadata.languageId;

	if (languageId === 'r') {
		// Fire-and-forget interactive execution; ignore acceptance-promise
		// rejections (e.g. RPC failures) so they don't surface as unhandled.
		Promise.resolve(session.execute(
			`help(package = "${packageName}", help_type = "html")`,
			generateUuid(),
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Stop,
		)).catch(() => { });
		return;
	}

	const found = await helpService.showHelpTopic(languageId, packageName);
	if (!found) {
		notificationService.info(
			localize('positron.packages.noHelpFound', "No help found for '{0}'.", packageName)
		);
	}
}
