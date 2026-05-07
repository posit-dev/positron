/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ActiveEditorDirtyContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { SAVE_FILE_COMMAND_ID, SAVE_FILE_LABEL } from '../../files/browser/fileConstants.js';

// Adds the Save File button to the editor action bar so it sits with the
// editor it acts on. Always rendered for file-backed editors (text editors,
// Quarto, Positron notebooks); precondition disables it when the active editor
// is clean.
//
// Group `1_save` (not `navigation`): the menu service special-cases
// `navigation` to render first regardless of group-name order, so Save in
// `navigation` would sit to the left of editor-specific actions like Quarto's
// `0_preview` Render buttons or the notebook's `navigation` Run / Clear / Add
// cluster. `1_save` sorts lexically after those, placing Save just to the
// right of them with a group separator between.
MenuRegistry.appendMenuItem(MenuId.EditorActionsLeft, {
	command: {
		id: SAVE_FILE_COMMAND_ID,
		title: SAVE_FILE_LABEL,
		icon: ThemeIcon.fromId('positron-save'),
		precondition: ActiveEditorDirtyContext,
	},
	group: '1_save',
	order: 10,
	when: ResourceContextKey.IsFileSystemResource,
});


