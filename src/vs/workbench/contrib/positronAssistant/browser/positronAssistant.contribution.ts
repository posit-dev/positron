/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
import { ICodeBlockActionContext } from '../../chat/browser/widget/chatContentParts/codeBlockPart.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { RuntimeCodeExecutionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ChatAgentLocation, ChatConfiguration } from '../../chat/common/constants.js';
import { CodeAttributionSource, IConsoleCodeAttribution } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { NextEditSuggestionsStatusBarEntry } from './nextEditSuggestionsStatusBar.js';
import { CommitMessageMenuContribution, registerCommitMessageGeneration } from './commitMessageAction.js';
import { AiExtensionActivationContribution } from './aiExtensionActivation.js';
import { PositronAssistantToolsContribution } from './tools/positronAssistantTools.js';

// Register the `ai.enabled` main switch for Positron's AI features.
import '../common/positronAIConfiguration.js';

// Register the migration from the deprecated
// `positron.assistant.inlineCompletions.enable` setting to `github.copilot.enable`.
import './inlineCompletionsMigration.js';

// Register the commit message generation feature.
registerCommitMessageGeneration();

const consoleLanguageIds = ['r', 'python'];

class PositronAssistantContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
	) {
		super();

		// Add "Configure Language Model Providers" to the Accounts menu
		registerAction2(class ConfigureProvidersFromAccountsAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.positronAssistant.configureProvidersFromAccounts',
					title: localize2('positron.configureProviders', "Configure Language Model Providers"),
					menu: {
						id: MenuId.AccountsContext,
						group: '3_configuration',
						// Configuring language model providers is about provider
						// availability, not the chat UI, so it must stay reachable
						// even when `chat.disableAIFeatures` is true (which gates
						// `ChatContextKeys.enabled`). OR in the AI-disabled state so
						// the setting can never hide this entry.
						when: ContextKeyExpr.or(ChatContextKeys.enabled, ContextKeyExpr.has(`config.${ChatConfiguration.AIDisabled}`)),
					},
				});
			}

			override async run(accessor: ServicesAccessor): Promise<void> {
				return accessor.get(ICommandService).executeCommand('authentication.configureProviders');
			}
		});

		// Add "play" button to sidebar chat code block actions
		const consoleService = this._consoleService;
		registerAction2(class RunInConsoleAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.positronAssistant.runInConsole',
					title: localize2('interactive.runInConsole.label', "Run in Console"),
					precondition: ChatContextKeys.available,
					f1: true,
					category: localize2('chat.category', 'Chat'),
					icon: codiconsLibrary.play,
					menu: {
						id: MenuId.ChatCodeBlock,
						group: 'navigation',
						order: 5,
						when: ContextKeyExpr.and(
							ContextKeyExpr.equals(ChatContextKeys.location.key, ChatAgentLocation.Chat),
							ChatContextKeys.Editing.hasToolConfirmation.toNegated(),
							// TODO: We should use a context key so that we can dynamically include languages
							//       that can execute code in the console i.e. with registered interpreters.
							//       See: https://github.com/posit-dev/positron/issues/8219.
							ContextKeyExpr.or(...consoleLanguageIds.map(e => ContextKeyExpr.equals(EditorContextKeys.languageId.key, e))),
						),
					},
				});
			}

			run(accessor: ServicesAccessor, context: ICodeBlockActionContext): void | Promise<void> {
				const attribution: IConsoleCodeAttribution = {
					source: CodeAttributionSource.Assistant
				};
				consoleService.executeCode(
					context.languageId || '',
					undefined, // run in any session
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
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(NextEditSuggestionsStatusBarEntry, LifecyclePhase.Restored);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(CommitMessageMenuContribution, LifecyclePhase.Restored);

// Fire the custom AI activation events (`onAiEnabled`, `onCopilotEnabled`) so
// the bundled AI extensions activate lazily while their backing settings are
// on. Registered at `Eventually` to preserve the deferred timing those
// extensions had under `onStartupFinished`.
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(AiExtensionActivationContribution, LifecyclePhase.Eventually);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronAssistantToolsContribution, LifecyclePhase.Restored);

