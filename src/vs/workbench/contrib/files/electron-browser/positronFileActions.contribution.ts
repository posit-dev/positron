/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize2 } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IListService } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { WorkspaceTrustContext } from '../../workspace/common/workspace.js';
import { getMultiSelectedResources, IExplorerService } from '../browser/files.js';
import { ExplorerFolderContext } from '../common/files.js';

export const OPEN_WITH_DEFAULT_APPLICATION_COMMAND_ID = 'workbench.action.files.openWithDefaultApplication';

const INTEGRATED_BROWSER_EXTENSIONS = /\.(?:html?|mht(?:ml)?)$/i;

/** Opens each selected local file with the application the OS associates with it. */
async function openWithDefaultApplication(accessor: ServicesAccessor, resource?: URI): Promise<void> {
	const explorerService = accessor.get(IExplorerService);
	const openerService = accessor.get(IOpenerService);
	const resources = getMultiSelectedResources(resource, accessor.get(IListService), accessor.get(IEditorService), accessor.get(IEditorGroupsService), explorerService);

	// The selection can mix files with folders, even though the menu item is
	// only offered when the right-clicked item is a file.
	const files = resources.filter(file => file.scheme === Schemas.file && !explorerService.findClosest(file)?.isDirectory);

	// Pass a string: given a URI, the opener service double-encodes '#' and '?'.
	await Promise.all(files.map(file => openerService.open(file.toString(), { openExternal: true })));
}

CommandsRegistry.registerCommand(OPEN_WITH_DEFAULT_APPLICATION_COMMAND_ID, openWithDefaultApplication);

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: 'navigation',
	order: 25,
	command: {
		id: OPEN_WITH_DEFAULT_APPLICATION_COMMAND_ID,
		title: localize2('positron.openWithDefaultApplication', "Open with Default Application")
	},
	// The default application runs executables and scripts, so require trust.
	when: ContextKeyExpr.and(
		ResourceContextKey.Scheme.isEqualTo(Schemas.file),
		ExplorerFolderContext.toNegated(),
		ContextKeyExpr.regex(ResourceContextKey.Extension.key, INTEGRATED_BROWSER_EXTENSIONS).negate(),
		WorkspaceTrustContext.IsTrusted
	)
});
