/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { FastCheap, IHeadlessLanguageModelService, intentFromSetting, ModelSelection, UnavailableReason } from '../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { showHeadlessModelPicker } from '../../../services/positronHeadlessLanguageModel/browser/headlessModelPicker.js';
import { ISCMService } from '../../scm/common/scm.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';
import { buildCommitMessageContext, COMMIT_MESSAGE_SYSTEM_PROMPT } from './commitMessageDiff.js';

/** Setting controlling whether the commit message generator is offered. */
export const GIT_SUGGESTIONS_ENABLED_KEY = 'git.suggestions.enabled';

/** Setting holding the ordered model patterns used for commit messages (empty = fast/cheap tier). */
export const GIT_SUGGESTIONS_MODEL_KEY = 'git.suggestions.model';

const SELECT_GIT_SUGGESTIONS_MODEL_COMMAND_ID = 'positron.git.selectSuggestionsModel';

/** Read the configured model selection (empty patterns fall back to the fast/cheap tier). */
function commitMessageModelSelection(configurationService: IConfigurationService): ModelSelection {
	const patterns = configurationService.getValue<string[]>(GIT_SUGGESTIONS_MODEL_KEY);
	return patterns ? intentFromSetting(patterns) : FastCheap;
}

/** A short description of a model selection. */
function describeModelSelection(selection: ModelSelection): string {
	if (hasKey(selection, { tier: true })) {
		return selection.tier === 'fast-cheap'
			? localize('positron.git.suggestions.fastCheapTier', "default")
			: selection.tier;
	}
	if (hasKey(selection, { id: true })) {
		return selection.id;
	}
	return selection.patterns.join(', ');
}

/** Register the git suggestion settings (gate plus model patterns). */
function registerCommitMessageConfiguration(): void {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
		id: 'gitSuggestions',
		order: 8,
		title: localize('positron.git.suggestions.title', "Git Suggestions"),
		type: 'object',
		properties: {
			[GIT_SUGGESTIONS_ENABLED_KEY]: {
				type: 'boolean',
				default: true,
				description: localize(
					'positron.git.suggestions.enabled',
					"Enable AI-assisted Git features, such as the button that suggests a commit message from the current changes."
				),
				scope: ConfigurationScope.WINDOW,
			},
			[GIT_SUGGESTIONS_MODEL_KEY]: {
				type: 'array',
				items: { type: 'string' },
				default: [],
				markdownDescription: localize(
					'positron.git.suggestions.model',
					"Model patterns for Git suggestions. [Select a model](command:{0}) or specify patterns manually. Patterns are tried in order until one matches an available model (case-insensitive). When left empty, the default tier is used.",
					SELECT_GIT_SUGGESTIONS_MODEL_COMMAND_ID
				),
				scope: ConfigurationScope.WINDOW,
			},
		},
	});
}

/**
 * A user-facing message for an unavailable model.
 */
function unavailableMessage(reason: UnavailableReason): string | undefined {
	switch (reason) {
		case 'sign-in-required':
			return localize('positron.git.commitMessage.signInRequired', "Sign in to a language model provider to generate a commit message.");
		case 'no-providers-configured':
		case 'no-model-matched':
			return localize('positron.git.commitMessage.noModel', "No language model is available to generate a commit message.");
		case 'temporarily-unavailable':
			return undefined;
	}
}

/** The context-key expression gating the commit message UI. */
const commitMessagePrecondition = ContextKeyExpr.and(
	ContextKeyExpr.equals('scmProvider', 'git'),
	ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
	ContextKeyExpr.has(`config.${GIT_SUGGESTIONS_ENABLED_KEY}`),
);

/**
 * Generate a commit message for the current Source Control changes and stream it
 * into the commit input box.
 *
 * Registered without a menu entry: {@link CommitMessageMenuContribution} owns the
 * `SCMInputBox` entry so its title can reflect the configured model selection.
 */
export class GenerateCommitMessageAction extends Action2 {
	static readonly ID = 'positron.git.generateCommitMessage';

	constructor() {
		super({
			id: GenerateCommitMessageAction.ID,
			title: localize2('positron.git.generateCommitMessage', "Generate Commit Message"),
			icon: Codicon.sparkle,
			f1: false,
			precondition: commitMessagePrecondition,
		});
	}

	override async run(accessor: ServicesAccessor, rootUri: URI, _context: unknown, token: CancellationToken): Promise<void> {
		const scmService = accessor.get(ISCMService);
		const fileService = accessor.get(IFileService);
		const configurationService = accessor.get(IConfigurationService);
		const headlessService = accessor.get(IHeadlessLanguageModelService);
		const uriIdentityService = accessor.get(IUriIdentityService);
		const logService = accessor.get(ILogService);
		const notificationService = accessor.get(INotificationService);

		const repository = [...scmService.repositories].find(repo =>
			uriIdentityService.extUri.isEqual(repo.provider.rootUri, rootUri));
		if (!repository) {
			logService.warn(`[git] No SCM repository found for ${rootUri.toString()}.`);
			return;
		}

		try {
			const context = await buildCommitMessageContext(fileService, rootUri, repository.provider.groups);
			if (!context) {
				logService.info('[git] No changes available for commit message generation.');
				notificationService.info(localize('positron.git.commitMessage.noChanges', "There are no changes to summarize into a commit message."));
				return;
			}

			const result = await headlessService.streamText({
				systemPrompt: COMMIT_MESSAGE_SYSTEM_PROMPT,
				messages: [{ role: 'user', content: context }],
				model: commitMessageModelSelection(configurationService),
				cancellationToken: token,
			});

			if (!result.available) {
				logService.warn(`[git] Commit message generation unavailable: ${result.reason}.`);
				const message = unavailableMessage(result.reason);
				if (message) {
					notificationService.warn(message);
				}
				return;
			}

			let message = '';
			repository.input.setValue('', false);
			for await (const delta of result.text) {
				if (token.isCancellationRequested) {
					return;
				}
				message += delta;
				repository.input.setValue(message, false);
			}
		} catch (error) {
			logService.error('[git] Error generating commit message:', error);
			notificationService.error(localize('positron.git.commitMessage.error', "Failed to generate a commit message. See the log for details."));
		}
	}
}

/** Open the model picker for Git suggestion features. */
export class SelectGitSuggestionsModelAction extends Action2 {
	static readonly ID = SELECT_GIT_SUGGESTIONS_MODEL_COMMAND_ID;

	constructor() {
		super({
			id: SelectGitSuggestionsModelAction.ID,
			title: localize2('positron.git.selectSuggestionsModel', "Select Git Suggestions Model"),
			f1: true,
			category: localize2('positron.git.category', "Git"),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await showHeadlessModelPicker(
			accessor.get(IHeadlessLanguageModelService),
			accessor.get(IQuickInputService),
			accessor.get(IConfigurationService),
			{
				settingKey: GIT_SUGGESTIONS_MODEL_KEY,
				title: localize('positron.git.selectSuggestionsModel.title', "Select Model for Git Suggestions"),
			},
		);
	}
}

/**
 * Owns the `SCMInputBox` menu entry for {@link GenerateCommitMessageAction},
 * re-appending it with a title that names the configured model selection. The
 * title refreshes when the model setting changes.
 */
export class CommitMessageMenuContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronGitCommitMessageMenu';

	private readonly _menuItem = this._register(new MutableDisposable());

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(GIT_SUGGESTIONS_MODEL_KEY)) {
				this._update();
			}
		}));

		this._update();
	}

	private _update(): void {
		const selection = commitMessageModelSelection(this._configurationService);
		const title = localize('positron.git.generateCommitMessage.withModel', "Generate Commit Message (Model: {0})", describeModelSelection(selection));

		this._menuItem.value = MenuRegistry.appendMenuItem(MenuId.SCMInputBox, {
			command: {
				id: GenerateCommitMessageAction.ID,
				title,
				icon: Codicon.sparkle,
				precondition: commitMessagePrecondition,
			},
			when: commitMessagePrecondition,
			group: 'navigation',
		});
	}
}

/** Register the commit message settings and actions. */
export function registerCommitMessageGeneration(): void {
	registerCommitMessageConfiguration();
	registerAction2(GenerateCommitMessageAction);
	registerAction2(SelectGitSuggestionsModelAction);
}
