/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { POSITRON_PACKAGES_ENABLED } from './positronPackagesContextKeys.js';
import { getPackages } from './positronPackagesCommands.js';

/**
 * Command Palette entry that shows the positronPackages.getPackages payload --
 * the same JSON Assistant reads -- in an untitled editor. Unlike the command it
 * wraps, this ships rather than being development-only, so the payload can be
 * inspected in a release build.
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
		// The accessor stops being valid at the first await, so the editor
		// service is resolved up front and getPackages is called before
		// anything is awaited (it resolves the services it needs synchronously).
		const editorService = accessor.get(IEditorService);
		const packages = await getPackages(accessor);

		await editorService.openEditor({
			resource: undefined,
			contents: JSON.stringify(packages, null, 2),
			languageId: 'json',
			options: { pinned: true },
		} satisfies IUntitledTextResourceEditorInput);
	}
}

registerAction2(ShowPackagesAction);
