/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { ReplCommandId, REPL_ACTION_CATEGORY } from 'vs/workbench/contrib/repl/common/repl';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Codicon } from 'vs/base/common/codicons';
import { ICreateReplOptions, IReplService } from 'vs/workbench/contrib/repl/browser/repl';

export function registerReplActions() {
	const category: ILocalizedString = { value: REPL_ACTION_CATEGORY, original: 'Terminal' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: ReplCommandId.New,
				title: { value: localize('workbench.action.repl.new', "Create New Console"), original: 'Create New Console' },
				f1: true,
				category,
				// TODO: Do we need to add the 'precondition' key here? Is there any context
				// in which the REPL would be unsupported?
				icon: Codicon.plus,
				// TODO: Add 'keybinding' member with a default keybinding
				description: {
					description: 'workbench.action.repl.new',
					args: [{
						name: 'eventOrOptions',
						schema: {
							type: 'object'
						}
					}]
				}
			});
		}

		/**
		 * Runs the repl.new command to create a new REPL instance.
		 *
		 * @param accessor The service accessor.
		 * @param options The options for the new REPL instance.
		 */
		async run(accessor: ServicesAccessor, options?: ICreateReplOptions | undefined) {
			const replService = accessor.get(IReplService);
			await replService.createRepl(options);
		}
	});
}
