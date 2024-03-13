/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';

/**
 * Positron modal dialogs command ID's.
 */
const enum PositronModalDialogsCommandId {
	ShowExampleDialog = 'workbench.action.positronModalDialogs.showExampleDialog',
}

/**
 * Positron modal dialogs action category.
 */
const POSITRON_MODAL_DIALOGS_ACTION_CATEGORY = localize('positronModalDialogsCategory', "ModalDialogs");

/**
 * Registers Positron modal dialogs actions.
 */
export function registerPositronModalDialogsActions() {
	/**
	 * The category for the actions below.
	 */
	const category: ILocalizedString = {
		value: POSITRON_MODAL_DIALOGS_ACTION_CATEGORY,
		original: 'ModalDialogs'
	};

	/**
	 * Register the show example modal dialog action.
	 */
	registerAction2(class extends Action2 {
		/**
		 * Constructor.
		 */
		constructor() {
			super({
				id: PositronModalDialogsCommandId.ShowExampleDialog,
				title: {
					value: localize('workbench.action.positronModalDialogs.showExampleModalDialog', "Show Example Modal Dialog"),
					original: 'Show Example Dialog'
				},
				f1: true,
				category,
				precondition: IsDevelopmentContext
			});
		}

		/**
		 * Runs action.
		 * @param accessor The services accessor.
		 */
		async run(accessor: ServicesAccessor) {
			const positronModalDialogsService = accessor.get(IPositronModalDialogsService);
			positronModalDialogsService.showExampleModalDialog1('Example');
		}
	});
}
