/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { LanguageRuntimeCommandId, LANGUAGE_RUNTIME_ACTION_CATEGORY } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Codicon } from 'vs/base/common/codicons';

export function registerLanguageRuntimeActions() {
	const category: ILocalizedString = { value: LANGUAGE_RUNTIME_ACTION_CATEGORY, original: 'Language Runtime' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: LanguageRuntimeCommandId.Select,
				title: { value: localize('workbench.action.language.runtime.select', "Select Active Language Runtime"), original: 'Select Active Language Runtime' },
				f1: true,
				category,
				icon: Codicon.plus,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.language.runtime.select',
					args: [{
						name: 'options',
						schema: {
							type: 'object'
						}
					}]
				}
			});
		}

		/**
		 * Runs the select.language.runtime command to select a language runtime
		 *
		 * @param accessor The service accessor.
		 */
		async run(accessor: ServicesAccessor) {
			throw new Error('Sorry, no idea how to do that.');
		}
	});
}
