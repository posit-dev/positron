/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { POSITRON_PACKAGES_ENABLED } from './positronPackagesContextKeys.js';
import { getPackages } from './positronPackagesCommands.js';

/**
 * Command Palette entry that shows the positronPackages.getPackages payload --
 * the same JSON Assistant reads -- in an untitled editor. Unlike the command it
 * wraps, this ships rather than being development-only, so the payload can be
 * inspected in a release build.
 *
 * Wrapped in progress because the command fills its own gaps: on a cold cache
 * it queries the repositories for outdated state and Package Manager for
 * security advisories before answering, which takes seconds. A palette entry
 * that sat silent for that long would read as a hang, and the delay only shows
 * up on exactly the runs a developer reaches for this to inspect.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class ShowPackagesAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.showPackages',
			title: localize2('positron.packages.showPackages', 'Show Packages as JSON'),
			category: localize2('packages', 'Packages'),
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// The accessor stops being valid at the first await, so the services are
		// resolved up front and getPackages is called before anything is awaited
		// (it resolves the services it needs synchronously).
		const editorService = accessor.get(IEditorService);
		const progressService = accessor.get(IProgressService);
		const packagesPromise = getPackages(accessor);

		const packages = await progressService.withProgress({
			title: localize('positron.packages.showPackages.reading', "Reading packages..."),
			location: ProgressLocation.Notification,
			// A warm cache answers immediately; only a real round trip should
			// put a notification on screen.
			delay: 500,
		}, () => packagesPromise);

		await editorService.openEditor({
			resource: undefined,
			contents: JSON.stringify(packages, null, 2),
			languageId: 'json',
			options: { pinned: true },
		} satisfies IUntitledTextResourceEditorInput);
	}
}

registerAction2(ShowPackagesAction);
