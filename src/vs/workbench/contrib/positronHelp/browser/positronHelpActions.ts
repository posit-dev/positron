/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditor } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Action2 } from 'vs/platform/actions/common/actions';
import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IPositronHelpService } from 'vs/workbench/contrib/positronHelp/browser/positronHelpService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { PositronConsoleFocused } from 'vs/workbench/common/contextkeys';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';

export class ShowHelpAtCursor extends Action2 {
	constructor() {
		super({
			id: 'positron.help.showHelpAtCursor',
			title: {
				value: localize('positron.help.showHelpAtCursor', 'Show Help at Cursor'),
				original: 'Show Help at Cursor'
			},
			keybinding: {
				// Use "EditorCore" keybinding weight (0, the most assertive) so
				// we can ensure we get the valuable F1 keybinding for Help.
				weight: KeybindingWeight.EditorCore,
				primary: KeyCode.F1,
				secondary: [KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyH)],
				when: ContextKeyExpr.or(EditorContextKeys.focus, PositronConsoleFocused)
			},
			category: Categories.Help,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const helpService = accessor.get(IPositronHelpService);
		const languageFeaturesService = accessor.get(ILanguageFeaturesService);
		const notificationService = accessor.get(INotificationService);
		const languageService = accessor.get(ILanguageService);
		const consoleService = accessor.get(IPositronConsoleService);

		// Look up the active editor
		let editor = editorService.activeTextEditorControl as IEditor;

		// Prefer the active console instance if it's focused
		const inputEditor = consoleService.activeInputTextEditor;
		if (inputEditor) {
			if (inputEditor.hasTextFocus()) {
				editor = inputEditor;
			}
		}

		// If we didn't find an editor, we can't show help here. This should be
		// rare since the keybinding for this command is only active when an
		// editor or the console is focused.
		if (!editor) {
			notificationService.info(localize('positron.help.noHelpSource', "No help is available here. Place the cursor in the editor on the item you'd like help with."));
			return;
		}

		// Get the position of the cursor to see where we should show help.
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		// Get all the help topic providers for the current language.
		const model = editor.getModel() as ITextModel;
		const helpTopicProviders =
			languageFeaturesService.helpTopicProvider.all(model);
		if (helpTopicProviders.length > 0) {
			// Use the first provider to get the help topic and show it.
			const provider = helpTopicProviders[0];
			try {
				// Ask the provider for the help topic at the cursor.
				const topic = await provider.provideHelpTopic(
					model,
					position,
					CancellationToken.None);

				// Determine the language ID at the cursor position.
				//
				// Consider: Should the language ID be provided by the help
				// topic provider instead? (Seems more flexible for multi-modal
				// docs?)
				const languageId = model.getLanguageIdAtPosition(
					position.lineNumber,
					position.column);
				const languageName = languageService.getLanguageName(languageId);

				if (typeof topic === 'string' && topic.length > 0) {
					// Get help for the topic.
					const found = await helpService.showHelpTopic(languageId, topic);
					if (!found) {
						notificationService.info(localize('positron.help.helpTopicNotFound', "No {0} help available for '{1}'", languageName, topic));
					}

				} else {
					notificationService.info(localize('positron.help.noHelpTopic', "No {0} help is available at this location.", languageName));
				}
			} catch (err) {
				// If the provider throws an exception, log it and continue
				notificationService.warn(localize('positron.help.helpTopicError', "An error occurred while looking up the help topic: {0}", err.message));
			}
		}
	}
}

export class LookupHelpTopic extends Action2 {
	constructor() {
		super({
			id: 'positron.help.lookupHelpTopic',
			title: {
				value: localize('positron.help.lookupHelpTopic', 'Look Up Help Topic'),
				original: 'Look Up Help Topic'
			},
			category: Categories.Help,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const helpService = accessor.get(IPositronHelpService);
		const runtimeService = accessor.get(ILanguageRuntimeService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const languageService = accessor.get(ILanguageService);

		// Very likely the user's interested in a help topic for the language
		// they're currently editing, so use that as the default.
		let languageId = undefined;
		const editor = editorService.activeTextEditorControl as IEditor;
		if (editor) {
			const model = editor.getModel() as ITextModel;
			languageId = model.getLanguageId();
		}

		// If no language ID from an open editor, try to get the language ID
		// from the active runtime.
		if (!languageId) {
			const runtime = runtimeService.activeRuntime;
			if (runtime) {
				languageId = runtime.metadata.languageId;
			} else {
				const message = localize('positron.help.noInterpreters', "There are no interpreters running. Start an interpreter to look up help topics.");
				notificationService.info(message);
				return;
			}
		}

		// Make sure we have a runtime for the language ID.
		const runtimes = runtimeService.runningRuntimes;
		let found = false;
		for (const runtime of runtimes) {
			if (runtime.metadata.languageId === languageId) {
				found = true;
				break;
			}
		}
		if (!found) {
			const message = localize('positron.help.noLanguage', "Open a file for the language you want to look up help topics for, or start an interpreter for that language.");
			notificationService.info(message);
			return;
		}

		// Look up the friendly name of the language ID
		const languageName = languageService.getLanguageName(languageId);

		// Prompt the user for a help topic.
		const topic = await quickInputService.input({
			prompt: localize('positron.help.enterHelpTopic', "Enter {0} help topic", languageName),
			value: '',
			ignoreFocusLost: true,
			validateInput: async (value: string) => {
				if (value.length === 0) {
					return localize('positron.help.noTopic', "No help topic provided.");
				}
				return undefined;
			}
		});

		// If the user entered a topic, show it.
		if (topic) {
			const found = helpService.showHelpTopic(languageId, topic);
			if (!found) {
				const message = localize('positron.help.helpTopicUnavailable', "No help found for '{0}'.", topic);
				notificationService.info(message);
				return;
			}
		}
	}
}
