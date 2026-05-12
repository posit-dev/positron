/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../../../platform/layout/browser/layoutService.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../common/positronNotebookCommon.js';
import { NotebookHelpPanel, resolveShortcutBindings } from './NotebookHelpPanel.js';

const NOTEBOOK_HELP_ACTION_ID = 'positronNotebook.showKeyboardShortcuts';

registerAction2(class NotebookShowKeyboardShortcutsAction extends Action2 {
	constructor() {
		super({
			id: NOTEBOOK_HELP_ACTION_ID,
			title: localize2('positron.notebookHelp.action', 'Keyboard Shortcuts'),
			tooltip: localize2('positron.notebookHelp.tooltip', 'Show Notebook Keyboard Shortcuts'),
			icon: Codicon.keyboard,
			f1: true,
			category: localize2('positronNotebook.category', 'Notebook'),
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 55,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			}
		});
	}

	override run(accessor: ServicesAccessor): void {
		const keybindingService = accessor.get(IKeybindingService);
		const layoutService = accessor.get(ILayoutService);

		// Resolve keybindings while the notebook editor still has focus,
		// before the modal steals it and changes the active context.
		const resolvedBindings = resolveShortcutBindings(keybindingService);

		const renderer = new PositronModalReactRenderer({
			container: layoutService.activeContainer,
		});

		renderer.render(
			<NotebookHelpPanel
				renderer={renderer}
				resolvedBindings={resolvedBindings}
			/>
		);
	}
});
