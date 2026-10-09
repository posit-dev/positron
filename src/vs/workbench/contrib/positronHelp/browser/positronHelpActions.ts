/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditor } from '../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronHelpService } from './positronHelpService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { PositronConsoleFocused } from '../../../common/contextkeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { POSITRON_RUNTIME_LANGUAGE_IDS } from '../../languageRuntime/browser/languageRuntimeContextKeys.js';

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
			f1: true,
			menu: [
				{
					id: MenuId.EditorContext,
					// Show on editors whose language has a registered Positron
					// runtime. The list is maintained dynamically by
					// PositronRuntimeLanguagesContextKeyContribution so new
					// runtimes are picked up without code changes here.
					//
					// Quarto is added explicitly: a .qmd document's outer
					// language is 'quarto', but the command still works
					// because it resolves the embedded language at the
					// cursor via getLanguageIdAtPosition.
					when: ContextKeyExpr.and(
						EditorContextKeys.editorTextFocus,
						ContextKeyExpr.or(
							ContextKeyExpr.in(
								EditorContextKeys.languageId.key,
								POSITRON_RUNTIME_LANGUAGE_IDS.key,
							),
							ContextKeyExpr.equals(
								EditorContextKeys.languageId.key,
								'quarto',
							),
						),
					),
					// Sit just below "Go to References" (order 1.45) and just
					// above "View Data Frame at Cursor" (order 1.5) in the
					// editor context menu's navigation group.
					group: 'navigation',
					order: 1.47,
				},
			],
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

		// Prefer the active code editor, if it exists and it's focused.
		if (consoleService.activeCodeEditor?.hasTextFocus()) {
			editor = consoleService.activeCodeEditor;
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

/**
 * Result of the lookupHelpTopic command, returned to programmatic callers
 * (notably agents via `positron.ai.validateAndExecuteCommand`).
 */
interface ILookupHelpTopicResult {
	found: boolean;
	topic?: string;
	languageId?: string;
	message?: string;
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
			f1: true,
			metadata: {
				description: localize('positron.help.lookupHelpTopic.description', "Show help for a topic, such as a function name, in the Help pane. Uses the language of the active editor, or of the foreground interpreter session when no editor is open. Requires a running interpreter session for that language."),
				agentCompatible: true,
				args: [
					{ name: 'topic', description: 'Help topic to look up, typically a bare function or symbol name (for example: mean).', schema: { type: 'string' } },
				],
				returns: 'An object with found, topic, languageId, and message. found is true when the help topic was shown in the Help pane, with topic and languageId confirming what was looked up and in which language; when found is false, message explains why (no topic provided, topic not found, no session for the language, or a lookup error).',
			},
		});
	}

	async run(accessor: ServicesAccessor, topicArg?: string): Promise<ILookupHelpTopicResult> {
		const editorService = accessor.get(IEditorService);
		const helpService = accessor.get(IPositronHelpService);
		const sessionService = accessor.get(IRuntimeSessionService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const languageService = accessor.get(ILanguageService);

		// Only treat a non-empty string as a supplied topic; otherwise prompt
		// the user for a help topic.
		const suppliedTopic = typeof topicArg === 'string' ? topicArg.trim() : '';

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
			const session = sessionService.foregroundSession;
			if (session) {
				languageId = session.runtimeMetadata.languageId;
			} else {
				const message = localize('positron.help.noInterpreters', "There are no interpreters running. Start an interpreter to look up help topics.");
				notificationService.info(message);
				return { found: false, message };
			}
		}

		// Make sure we have an active session for the language ID.
		const sessions = sessionService.activeSessions;
		let found = false;
		for (const session of sessions) {
			if (session.runtimeMetadata.languageId === languageId) {
				found = true;
				break;
			}
		}
		if (!found) {
			const message = localize('positron.help.noLanguage', "Open a file for the language you want to look up help topics for, or start an interpreter for that language.");
			notificationService.info(message);
			return { found: false, message };
		}

		// Look up the friendly name of the language ID
		const languageName = languageService.getLanguageName(languageId);

		const noTopicMessage = localize('positron.help.noTopic', "No help topic provided.");
		const topic = suppliedTopic || await quickInputService.input({
			prompt: localize('positron.help.enterHelpTopic', "Enter {0} help topic", languageName),
			value: '',
			ignoreFocusLost: true,
			validateInput: async (value: string) => {
				if (value.length === 0) {
					return noTopicMessage;
				}
				return undefined;
			}
		});

		// The input box returns undefined when dismissed without a topic.
		if (!topic) {
			return { found: false, message: noTopicMessage };
		}

		let helpShown = false;
		try {
			helpShown = await helpService.showHelpTopic(languageId, topic);
		} catch (err) {
			const message = localize('positron.help.errorLookingUpTopic',
				"Error finding help on '{0}': {1} ({2}).", topic, err.message, err.code);
			notificationService.warn(message);
			return { found: false, message };
		}
		if (!helpShown) {
			const message = localize('positron.help.helpTopicUnavailable',
				"No help found for '{0}'.", topic);
			notificationService.info(message);
			return { found: false, message };
		}
		return { found: true, topic, languageId };
	}
}

/**
 * Result of calling a help method on an interpreter session: the method's
 * result when it returned an object, or a message explaining why not.
 */
interface IHelpMethodResult<T> {
	languageId?: string;
	value?: T;
	message?: string;
}

/**
 * Calls a help method on an interpreter session for the given language
 * (defaulting to the foreground session's language), preferring the
 * foreground session. Runtimes return an object on success and a message
 * string otherwise.
 */
async function callHelpMethod<T>(
	sessionService: IRuntimeSessionService,
	languageIdArg: string | undefined,
	method: string,
	...args: string[]
): Promise<IHelpMethodResult<T>> {
	const foreground = sessionService.foregroundSession;
	const languageId = languageIdArg || foreground?.runtimeMetadata.languageId;
	const session = foreground?.runtimeMetadata.languageId === languageId ?
		foreground :
		sessionService.activeSessions.find(s => s.runtimeMetadata.languageId === languageId);
	if (!session?.callMethod) {
		return { languageId, message: languageId ? `No running ${languageId} interpreter session to read help from.` : 'No interpreter session is running.' };
	}

	try {
		const result = await session.callMethod(method, ...args);
		if (result && typeof result === 'object') {
			return { languageId, value: result as T };
		}
		return { languageId, message: typeof result === 'string' ? result : 'No help found.' };
	} catch (err) {
		return { languageId, message: `Error reading help: ${err.message}` };
	}
}

/**
 * Trims a string argument, treating anything else as empty.
 */
function stringArg(arg: unknown): string {
	return typeof arg === 'string' ? arg.trim() : '';
}

const languageIdArg = { name: 'languageId', description: 'Language of the package or topic, such as r or python. Defaults to the language of the foreground interpreter session.', schema: { type: 'string' as const } };

/**
 * Result of the readHelpTopic command.
 */
interface IReadHelpTopicResult {
	found: boolean;
	languageId?: string;
	topic?: string;
	package?: string;
	content?: string;
	message?: string;
}

export class ReadHelpTopic extends Action2 {
	constructor() {
		super({
			id: 'positron.help.readHelpTopic',
			title: {
				value: localize('positron.help.readHelpTopic', 'Read Help Topic'),
				original: 'Read Help Topic'
			},
			category: Categories.Help,
			f1: false,
			metadata: {
				description: localize('positron.help.readHelpTopic.description', "Read the help page for a topic, such as a function, class, or package, from a running interpreter session and return it as Markdown. Does not show anything to the user. Covers any installed package, including private or internal ones."),
				agentCompatible: true,
				args: [
					{ name: 'topic', description: 'Help topic to read: a function, class, or other object name (for example: mean, or pandas.DataFrame.merge).', schema: { type: 'string' } },
					languageIdArg,
					{ name: 'package', description: 'Package containing the topic (for example: dplyr). Optional; when omitted, all installed packages are searched (R) or the topic is resolved as an import path (Python).', schema: { type: 'string' } },
				],
				returns: 'An object with found, languageId, topic, package, content, and message. When found is true, content is the help page as Markdown, and topic and package identify the page that was read. When found is false, message explains why (no topic provided, no session for the language, topic not found, or a lookup error).',
			},
		});
	}

	async run(accessor: ServicesAccessor, topicArg?: string, languageId?: string, packageArg?: string): Promise<IReadHelpTopicResult> {
		const topic = stringArg(topicArg);
		if (!topic) {
			return { found: false, message: 'No help topic provided.' };
		}

		const result = await callHelpMethod<{ help_text: string; topic: string; package: string }>(
			accessor.get(IRuntimeSessionService), languageId, 'get_help_page', topic, stringArg(packageArg));
		if (!result.value) {
			return { found: false, languageId: result.languageId, message: result.message };
		}
		const page = result.value;
		return { found: true, languageId: result.languageId, topic: page.topic, package: page.package, content: page.help_text };
	}
}

/**
 * Result of the listPackageDocs command.
 */
interface IListPackageDocsResult {
	found: boolean;
	languageId?: string;
	package?: string;
	topics?: { topic: string; title: string; aliases?: string }[];
	vignettes?: { name: string; title: string }[];
	message?: string;
}

export class ListPackageDocs extends Action2 {
	constructor() {
		super({
			id: 'positron.help.listPackageDocs',
			title: {
				value: localize('positron.help.listPackageDocs', 'List Package Documentation'),
				original: 'List Package Documentation'
			},
			category: Categories.Help,
			f1: false,
			metadata: {
				description: localize('positron.help.listPackageDocs.description', "List the documentation for an installed package from a running interpreter session: its help topics and its vignettes (long-form guides). Read individual pages with positron.help.readHelpTopic and positron.help.readVignette. For Python, topics are the package's public members, and the README is its only vignette."),
				agentCompatible: true,
				args: [
					{ name: 'package', description: 'Name of the package (for example: dplyr or pandas).', schema: { type: 'string' } },
					languageIdArg,
				],
				returns: 'An object with found, languageId, package, topics, vignettes, and message. When found is true, topics lists help topics (topic, title, and for R, aliases naming the functions the topic documents) and vignettes lists vignettes (name and title). When found is false, message explains why (no package provided, no session for the language, package not installed, or a lookup error).',
			},
		});
	}

	async run(accessor: ServicesAccessor, packageArg?: string, languageId?: string): Promise<IListPackageDocsResult> {
		const packageName = stringArg(packageArg);
		if (!packageName) {
			return { found: false, message: 'No package provided.' };
		}

		const result = await callHelpMethod<Required<Pick<IListPackageDocsResult, 'package' | 'topics' | 'vignettes'>>>(
			accessor.get(IRuntimeSessionService), languageId, 'list_package_docs', packageName);
		if (!result.value) {
			return { found: false, languageId: result.languageId, message: result.message };
		}
		// Runtimes may return null for an empty list.
		const docs = result.value;
		return {
			found: true,
			languageId: result.languageId,
			package: docs.package,
			topics: Array.isArray(docs.topics) ? docs.topics : [],
			vignettes: Array.isArray(docs.vignettes) ? docs.vignettes : [],
		};
	}
}

/**
 * Result of the readVignette command.
 */
interface IReadVignetteResult {
	found: boolean;
	languageId?: string;
	package?: string;
	vignette?: string;
	title?: string;
	content?: string;
	message?: string;
}

export class ReadVignette extends Action2 {
	constructor() {
		super({
			id: 'positron.help.readVignette',
			title: {
				value: localize('positron.help.readVignette', 'Read Vignette'),
				original: 'Read Vignette'
			},
			category: Categories.Help,
			f1: false,
			metadata: {
				description: localize('positron.help.readVignette.description', "Read a vignette (a long-form guide to a package) from a running interpreter session and return it as Markdown. Does not show anything to the user. Get vignette names from positron.help.listPackageDocs. For Python, the package's README is its only vignette, named README."),
				agentCompatible: true,
				args: [
					{ name: 'package', description: 'Name of the package (for example: dplyr).', schema: { type: 'string' } },
					{ name: 'vignette', description: 'Name of the vignette, as listed by positron.help.listPackageDocs (for example: colwise).', schema: { type: 'string' } },
					languageIdArg,
				],
				returns: 'An object with found, languageId, package, vignette, title, content, and message. When found is true, content is the vignette as Markdown (or its source, for vignettes without HTML output). When found is false, message explains why (missing arguments, no session for the language, vignette not found, or a lookup error).',
			},
		});
	}

	async run(accessor: ServicesAccessor, packageArg?: string, vignetteArg?: string, languageId?: string): Promise<IReadVignetteResult> {
		const packageName = stringArg(packageArg);
		const vignetteName = stringArg(vignetteArg);
		if (!packageName || !vignetteName) {
			return { found: false, message: 'Both a package and a vignette name are required.' };
		}

		const result = await callHelpMethod<{ content: string; title: string; name: string; package: string }>(
			accessor.get(IRuntimeSessionService), languageId, 'get_package_vignette', packageName, vignetteName);
		if (!result.value) {
			return { found: false, languageId: result.languageId, message: result.message };
		}
		const vignette = result.value;
		return { found: true, languageId: result.languageId, package: vignette.package, vignette: vignette.name, title: vignette.title, content: vignette.content };
	}
}
