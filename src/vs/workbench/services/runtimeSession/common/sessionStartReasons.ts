/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { ILocalizedString, localize2 } from '../../../../nls.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ILanguageRuntimeSession, IRuntimeSessionStartReason, SessionStartReasonId } from './runtimeSessionService.js';

/**
 * Values that fill in a start reason label.
 */
interface ISessionStartReasonLabelArgs {
	/** The session's language, such as "Python". */
	readonly languageName: string;
	/** The extension that provides the session's interpreter, such as "Python". */
	readonly extensionName: string;
	/** The session's runtime, such as "Python 3.12.4 (Pyenv)". */
	readonly runtimeName: string;
	/** The file name of the session's notebook, or empty for a console session. */
	readonly notebookFileName: string;
}

/**
 * The label shared by the two start reasons for a file being opened in the
 * session's language. The reasons stay separate so the two code paths can be
 * told apart.
 */
const languageFileOpenedLabel = (args: ISessionStartReasonLabelArgs) =>
	localize2('positron.sessionStartReason.languageFileOpened', "This interpreter was started after a file written in {0} was opened", args.languageName);

/**
 * User-facing labels for each session start reason.
 */
const sessionStartReasonLabels: Record<SessionStartReasonId, (args: ISessionStartReasonLabelArgs) => ILocalizedString> = {
	[SessionStartReasonId.AffiliatedRuntime]: () => localize2('positron.sessionStartReason.affiliatedRuntime', "This workspace's last used interpreter was started when Positron started"),
	[SessionStartReasonId.AffiliatedRuntimeAtRegistration]: () => localize2('positron.sessionStartReason.affiliatedRuntimeAtRegistration', "This workspace's last used interpreter was started when found by interpreter discovery"),
	[SessionStartReasonId.ExtensionRequestedImmediateStart]: args => localize2('positron.sessionStartReason.extensionRequestedImmediateStart', "The {0} extension recommended {1} for this workspace when interpreter discovery finished", args.extensionName, args.runtimeName),
	[SessionStartReasonId.ExtensionRequestedStartAtRegistration]: args => localize2('positron.sessionStartReason.extensionRequestedStartAtRegistration', "A new interpreter was found after startup, and the {0} extension recommended {1} for this workspace", args.extensionName, args.runtimeName),
	[SessionStartReasonId.ExtensionRecommendedRuntime]: args => localize2('positron.sessionStartReason.extensionRecommendedRuntime', "The {0} extension recommended starting {1} for this workspace", args.extensionName, args.runtimeName),
	[SessionStartReasonId.StartupBehaviorAlways]: args => localize2('positron.sessionStartReason.startupBehaviorAlways', "Startup Behavior is set to \"Always\" for {0}", args.languageName),
	[SessionStartReasonId.LanguageFileOpenedAtRegistration]: languageFileOpenedLabel,
	[SessionStartReasonId.LanguageFileOpened]: languageFileOpenedLabel,
	[SessionStartReasonId.UserSelectedRuntime]: () => localize2('positron.sessionStartReason.userSelectedRuntime', "You selected this interpreter"),
	[SessionStartReasonId.NewConsoleCommand]: () => localize2('positron.sessionStartReason.newConsoleCommand', "A command requested a new console for this interpreter"),
	[SessionStartReasonId.DuplicatedConsoleSession]: () => localize2('positron.sessionStartReason.duplicatedConsoleSession', "A console was duplicated"),
	[SessionStartReasonId.DuplicatedNotebookSession]: () => localize2('positron.sessionStartReason.duplicatedNotebookSession', "A notebook session was duplicated into a console"),
	[SessionStartReasonId.CodeExecutedWithoutSession]: args => localize2('positron.sessionStartReason.codeExecutedWithoutSession', "Code was sent to the console with no {0} session", args.languageName),
	[SessionStartReasonId.RestartUninitializedSession]: () => localize2('positron.sessionStartReason.restartUninitializedSession', "A restart was requested for a session that never started"),
	[SessionStartReasonId.NewFolderNotebook]: () => localize2('positron.sessionStartReason.newFolderNotebook', "This notebook was created with a new folder from the Jupyter Notebook template"),
	[SessionStartReasonId.QuartoInlineOutput]: () => localize2('positron.sessionStartReason.quartoInlineOutput', "A Quarto document with inline output needed a kernel"),
	[SessionStartReasonId.NotebookCellsExecuted]: () => localize2('positron.sessionStartReason.notebookCellsExecuted', "Notebook cells were run with no kernel running"),
	[SessionStartReasonId.NotebookCodeFragmentExecuted]: () => localize2('positron.sessionStartReason.notebookCodeFragmentExecuted', "Selected code in a notebook cell was run with no kernel"),
	[SessionStartReasonId.NotebookKernelSelected]: () => localize2('positron.sessionStartReason.notebookKernelSelected', "A kernel was selected for this notebook"),
	[SessionStartReasonId.NotebookKernelSelectionDeferred]: () => localize2('positron.sessionStartReason.notebookKernelSelectionDeferred', "This notebook's kernel started once its interpreter was found"),
	[SessionStartReasonId.NotebookEditorOpened]: args => localize2('positron.sessionStartReason.notebookEditorOpened', "The {0} notebook was opened", args.notebookFileName),
	[SessionStartReasonId.NotebookEditorActivated]: () => localize2('positron.sessionStartReason.notebookEditorActivated', "This notebook's preview tab was kept open, or its background tab was brought to the front"),
	[SessionStartReasonId.NotebookKernelRestart]: () => localize2('positron.sessionStartReason.notebookKernelRestart', "Restart Kernel was used with no kernel running"),
	[SessionStartReasonId.ExtensionApi]: () => localize2('positron.sessionStartReason.extensionApi', "An extension asked for this session through the Positron API"),
};

/**
 * Gets the user-facing label for why a session was started. Falls back to the
 * non-localized description for sessions without a known start reason ID,
 * such as sessions persisted before the ID existed.
 *
 * @param session The session.
 * @param extensions The registered extensions, used to find the display name
 * of the extension that provides the session's runtime.
 * @returns The label, or an empty string if the session has no start reason.
 */
export function getSessionStartReasonLabel(session: Pick<ILanguageRuntimeSession, 'runtimeMetadata' | 'metadata'>, extensions: readonly IExtensionDescription[]): string {
	const { runtimeMetadata, metadata } = session;
	const createLabel = metadata.startReasonId && sessionStartReasonLabels[metadata.startReasonId];
	if (!createLabel) {
		return metadata.startReason;
	}
	const extension = extensions.find(extension =>
		ExtensionIdentifier.equals(extension.identifier, runtimeMetadata.extensionId));
	return createLabel({
		languageName: runtimeMetadata.languageName,
		extensionName: extension?.displayName ?? runtimeMetadata.extensionId.value,
		runtimeName: runtimeMetadata.runtimeName,
		notebookFileName: metadata.notebookUri ? basename(metadata.notebookUri) : '',
	}).value;
}

/**
 * Creates the start reason for a request to start a runtime session. The
 * detail is the English label, followed by any values that identify the
 * request. The label is filled in from the `language`, `extension`,
 * `interpreter`, and `notebook` values.
 *
 * @param id Why the session is being started.
 * @param values Values that identify the request, such as the language ID.
 * @returns The start reason.
 */
export function createSessionStartReason(id: SessionStartReasonId, values?: Record<string, string>): IRuntimeSessionStartReason {
	const label = sessionStartReasonLabels[id]({
		languageName: values?.language ?? '',
		extensionName: values?.extension ?? '',
		runtimeName: values?.interpreter ?? '',
		notebookFileName: values?.notebook ?? '',
	}).original;
	const entries = Object.entries(values ?? {});
	const detail = entries.length ?
		`${label} (${entries.map(([key, value]) => `${key}: ${value}`).join(', ')})` :
		label;
	return { id, detail };
}
