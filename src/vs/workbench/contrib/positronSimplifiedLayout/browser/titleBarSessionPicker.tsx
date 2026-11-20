/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IAction } from '../../../../base/common/actions.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PositronActionBarContextProvider } from '../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { TopActionBarSessionPicker } from '../../../browser/parts/positronTopActionBar/components/topActionBarSessionPicker.js';
import { TitleBarLeadingActionsGroup } from '../../../browser/parts/titlebar/titlebarActions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { SIMPLIFIED_LAYOUT_ENABLED_KEY } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';

/**
 * The title bar menu item that holds the session picker in the simplified layout. It only
 * gives the picker a place in the title bar; the picker's own button runs the session commands.
 */
const TITLE_BAR_SESSION_PICKER_ID = 'workbench.action.positron.titleBarSessionPicker';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: TITLE_BAR_SESSION_PICKER_ID,
			title: localize2('positron.titleBarSessionPicker', "Interpreter Session"),
			menu: {
				id: MenuId.TitleBar,
				when: ContextKeyExpr.equals(`config.${SIMPLIFIED_LAYOUT_ENABLED_KEY}`, true),
				group: TitleBarLeadingActionsGroup,
				order: 0,
			},
		});
	}

	run(): void { }
});

/**
 * Draws the top action bar's session picker inside the VS Code title bar.
 */
class TitleBarSessionPickerActionViewItem extends BaseActionViewItem {
	private readonly _renderer = this._register(new MutableDisposable<PositronReactRenderer>());

	constructor(action: IAction, options: IBaseActionViewItemOptions | undefined) {
		super(undefined, action, options);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('positron-title-bar-session-picker');
		this._renderer.value = new PositronReactRenderer(container);
		this._renderer.value.render(
			<PositronActionBarContextProvider>
				<TopActionBarSessionPicker />
			</PositronActionBarContextProvider>
		);
	}
}

class TitleBarSessionPickerContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronTitleBarSessionPicker';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		actionViewItemService.register(MenuId.TitleBar, TITLE_BAR_SESSION_PICKER_ID, (action, options) =>
			instantiationService.createInstance(TitleBarSessionPickerActionViewItem, action, options)
		);
	}
}

registerWorkbenchContribution2(TitleBarSessionPickerContribution.ID, TitleBarSessionPickerContribution, WorkbenchPhase.BlockStartup);
