/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { codiconsLibrary } from '../../../../base/common/codiconsLibrary.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ICodeBlockActionContext } from '../../chat/browser/codeBlockPart.js';
import { CodeAttributionSource, IConsoleCodeAttribution, IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ChatAgentLocation } from '../../chat/common/chatAgents.js';
import { ChatContextKeys } from '../../chat/common/chatContextKeys.js';
import { RuntimeCodeExecutionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

class PositronAssistantContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
	) {
		super();

		// Add "play" button to sidebar chat code block actions
		const consoleService = this._consoleService;
		registerAction2(class RunInConsoleAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.positronAssistant.runInConsole',
					title: localize2('interactive.runInConsole.label', "Run in Console"),
					precondition: ChatContextKeys.enabled,
					f1: true,
					category: localize2('chat.category', 'Chat'),
					icon: codiconsLibrary.play,
					menu: {
						id: MenuId.ChatCodeBlock,
						group: 'navigation',
						order: 5,
						when: ContextKeyExpr.equals(ChatContextKeys.location.key, ChatAgentLocation.Panel)
					},
				});
			}

			run(accessor: ServicesAccessor, context: ICodeBlockActionContext): void | Promise<void> {
				const attribution: IConsoleCodeAttribution = {
					source: CodeAttributionSource.Assistant
				};
				consoleService.executeCode(
					context.languageId || '',
					context.code,
					attribution,
					true, // focus
					true, // allow incomplete
					RuntimeCodeExecutionMode.Interactive).then(
						() => {
							accessor.get(ILogService).debug(
								`Positron Assistant: ${context.languageId} code executed in console`);
						},
					).catch((err) => {
						accessor.get(INotificationService).error(err);
					});
			}
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronAssistantContribution, LifecyclePhase.Restored);
