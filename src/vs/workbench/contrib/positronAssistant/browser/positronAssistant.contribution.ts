/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronAssistantService } from './interfaces/positronAssistantService.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { CONTEXT_CHAT_ENABLED } from '../../chat/common/chatContextKeys.js';
import { codiconsLibrary } from '../../../../base/common/codiconsLibrary.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ICodeBlockActionContext } from '../../chat/browser/codeBlockPart.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

class PositronAssistantContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronAssistantService assistantService: IPositronAssistantService,
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
		const consoleService = this._consoleService;

		// Add "play" button to chat code block actions
		registerAction2(class RunInConsoleAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.positronAssistant.runInConsole',
					title: localize2('interactive.runInConsole.label', "Run in Console"),
					precondition: CONTEXT_CHAT_ENABLED,
					f1: true,
					category: localize2('chat.category', 'Chat'),
					icon: codiconsLibrary.play,
					menu: {
						id: MenuId.ChatCodeBlock,
						group: 'navigation',
						order: 5,
					},
				});
			}

			run(_: ServicesAccessor, context: ICodeBlockActionContext): void | Promise<void> {
				consoleService.activePositronConsoleInstance?.executeCode(context.code);
			}
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronAssistantContribution, LifecyclePhase.Restored);
