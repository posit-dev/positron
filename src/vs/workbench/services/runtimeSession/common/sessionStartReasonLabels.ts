/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { ILocalizedString, localize2 } from '../../../../nls.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionStartReason, SessionStartReason } from './runtimeSessionService.js';

/**
 * Names that fill in a start reason label.
 */
export interface ISessionStartReasonNames {
	/** The session's language, such as "Python". */
	readonly language: string;
	/** The extension that provides the session's interpreter, such as "Python". */
	readonly extension: string;
	/** The session's interpreter, such as "Python 3.12.4 (Pyenv)". */
	readonly interpreter: string;
	/** The file name of the session's notebook, or empty for a console session. */
	readonly notebook: string;
}

/**
 * The label shared by the two start reasons for a file being opened in the
 * session's language. The reasons stay separate so the two code paths can be
 * told apart.
 */
const languageFileOpenedLabel = (names: ISessionStartReasonNames) =>
	localize2('positron.sessionStartReason.languageFileOpened', "This interpreter was started after a file written in {0} was opened", names.language);

/**
 * User-facing labels for each session start reason.
 */
const sessionStartReasonLabels: Record<SessionStartReason, (names: ISessionStartReasonNames) => ILocalizedString> = {
	[SessionStartReason.AffiliatedRuntime]: () => localize2('positron.sessionStartReason.affiliatedRuntime', "This workspace's last used interpreter was started when Positron started"),
	[SessionStartReason.AffiliatedRuntimeRegistered]: () => localize2('positron.sessionStartReason.affiliatedRuntimeRegistered', "This workspace's last used interpreter was started when found by interpreter discovery"),
	[SessionStartReason.ExtensionRequestedImmediateStart]: names => localize2('positron.sessionStartReason.extensionRequestedImmediateStart', "The {0} extension recommended {1} for this workspace when interpreter discovery finished", names.extension, names.interpreter),
	[SessionStartReason.ExtensionRequestedStartAfterRegistration]: names => localize2('positron.sessionStartReason.extensionRequestedStartAfterRegistration', "A new interpreter was found after startup, and the {0} extension recommended {1} for this workspace", names.extension, names.interpreter),
	[SessionStartReason.ExtensionRecommendedRuntime]: names => localize2('positron.sessionStartReason.extensionRecommendedRuntime', "The {0} extension recommended starting the interpreter for this workspace", names.extension),
	[SessionStartReason.StartupBehaviorAlways]: names => localize2('positron.sessionStartReason.startupBehaviorAlways', "Startup Behavior is set to \"Always\" for {0}", names.language),
	[SessionStartReason.LanguageFileOpenAtRegistration]: languageFileOpenedLabel,
	[SessionStartReason.LanguageFileOpened]: languageFileOpenedLabel,
	[SessionStartReason.UserSelectedRuntime]: () => localize2('positron.sessionStartReason.userSelectedRuntime', "You selected this interpreter"),
	[SessionStartReason.NewConsoleCommand]: () => localize2('positron.sessionStartReason.newConsoleCommand', "A command requested a new console for this interpreter"),
	[SessionStartReason.DuplicatedConsoleSession]: () => localize2('positron.sessionStartReason.duplicatedConsoleSession', "A console was duplicated"),
	[SessionStartReason.DuplicatedNotebookSession]: () => localize2('positron.sessionStartReason.duplicatedNotebookSession', "A notebook session was duplicated into a console"),
	[SessionStartReason.CodeExecutedWithoutSession]: names => localize2('positron.sessionStartReason.codeExecutedWithoutSession', "Code was sent to the console with no {0} session", names.language),
	[SessionStartReason.RestartUninitializedSession]: () => localize2('positron.sessionStartReason.restartUninitializedSession', "A restart was requested for a session that never started"),
	[SessionStartReason.NewFolderNotebook]: () => localize2('positron.sessionStartReason.newFolderNotebook', "This notebook was created with a new folder from the Jupyter Notebook template"),
	[SessionStartReason.QuartoInlineOutput]: () => localize2('positron.sessionStartReason.quartoInlineOutput', "A Quarto document with inline output needed a kernel"),
	[SessionStartReason.NotebookCellsExecuted]: () => localize2('positron.sessionStartReason.notebookCellsExecuted', "Notebook cells were run with no kernel running"),
	[SessionStartReason.NotebookCodeFragmentExecuted]: () => localize2('positron.sessionStartReason.notebookCodeFragmentExecuted', "Selected code in a notebook cell was run with no kernel"),
	[SessionStartReason.NotebookKernelSelected]: () => localize2('positron.sessionStartReason.notebookKernelSelected', "A kernel was selected for this notebook"),
	[SessionStartReason.NotebookKernelSelectionDeferred]: () => localize2('positron.sessionStartReason.notebookKernelSelectionDeferred', "This notebook's kernel started once its interpreter was found"),
	[SessionStartReason.NotebookEditorOpened]: names => localize2('positron.sessionStartReason.notebookEditorOpened', "The {0} notebook was opened", names.notebook),
	[SessionStartReason.NotebookEditorActivated]: () => localize2('positron.sessionStartReason.notebookEditorActivated', "This notebook's preview tab was kept open, or its background tab was brought to the front"),
	[SessionStartReason.NotebookKernelRestart]: () => localize2('positron.sessionStartReason.notebookKernelRestart', "Restart Kernel was used with no kernel running"),
	[SessionStartReason.ExtensionApi]: () => localize2('positron.sessionStartReason.extensionApi', "An extension asked for this session through the Positron API"),
};

/**
 * Gets the user-facing label for why a session was started. Falls back to the
 * non-localized description for sessions without a known start reason ID,
 * such as sessions persisted before the ID existed.
 *
 * @param metadata The session's metadata.
 * @param names The names to fill in the label with.
 * @returns The label, or an empty string if the session has no start reason.
 */
export function getSessionStartReasonLabel(metadata: Pick<IRuntimeSessionMetadata, 'startReason' | 'startReasonId'>, names: ISessionStartReasonNames): string {
	const label = metadata.startReasonId && sessionStartReasonLabels[metadata.startReasonId]?.(names).value;
	return label || metadata.startReason;
}

/**
 * Gets the names that fill in a session's start reason label.
 *
 * @param session The session.
 * @param extensions The registered extensions, used to find the display name
 * of the extension that provides the session's interpreter.
 * @returns The names.
 */
export function getSessionStartReasonNames(session: Pick<ILanguageRuntimeSession, 'runtimeMetadata' | 'metadata'>, extensions: readonly IExtensionDescription[]): ISessionStartReasonNames {
	const { runtimeMetadata, metadata } = session;
	const extension = extensions.find(extension =>
		ExtensionIdentifier.equals(extension.identifier, runtimeMetadata.extensionId));
	return {
		language: runtimeMetadata.languageName,
		extension: extension?.displayName ?? runtimeMetadata.extensionId.value,
		interpreter: runtimeMetadata.runtimeName,
		notebook: metadata.notebookUri ? basename(metadata.notebookUri) : '',
	};
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
export function createSessionStartReason(id: SessionStartReason, values?: Record<string, string>): IRuntimeSessionStartReason {
	const label = sessionStartReasonLabels[id]({
		language: values?.language ?? '',
		extension: values?.extension ?? '',
		interpreter: values?.interpreter ?? '',
		notebook: values?.notebook ?? '',
	}).original;
	const entries = Object.entries(values ?? {});
	const detail = entries.length ?
		`${label} (${entries.map(([key, value]) => `${key}: ${value}`).join(', ')})` :
		label;
	return { id, detail };
}
