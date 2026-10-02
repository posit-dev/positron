/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ILocalizedString, localize2 } from '../../../../nls.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ILanguageRuntimeMetadata } from '../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionStartReason, SessionStartReasonId } from './runtimeSessionService.js';

/**
 * Values that fill in a start reason label, read from the runtime and notebook
 * the session is created for.
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
	[SessionStartReasonId.StartupBehaviorAlwaysAllLanguages]: () => localize2('positron.sessionStartReason.startupBehaviorAlwaysAllLanguages', "Startup Behavior is set to \"Always\""),
	[SessionStartReasonId.LanguageFileOpenedAtRegistration]: languageFileOpenedLabel,
	[SessionStartReasonId.LanguageFileOpened]: languageFileOpenedLabel,
	[SessionStartReasonId.UserSelectedRuntime]: () => localize2('positron.sessionStartReason.userSelectedRuntime', "You selected this interpreter"),
	[SessionStartReasonId.NewConsoleCommand]: () => localize2('positron.sessionStartReason.newConsoleCommand', "A command requested a new console for this interpreter"),
	[SessionStartReasonId.DuplicatedConsoleSession]: () => localize2('positron.sessionStartReason.duplicatedConsoleSession', "A console was duplicated"),
	[SessionStartReasonId.DuplicatedNotebookSession]: args => localize2('positron.sessionStartReason.duplicatedNotebookSession', "A console was started from the {0} notebook session", args.runtimeName),
	[SessionStartReasonId.CodeExecutedWithoutSession]: args => localize2('positron.sessionStartReason.codeExecutedWithoutSession', "Code was sent to the console with no {0} session", args.languageName),
	[SessionStartReasonId.RestartUninitializedSession]: () => localize2('positron.sessionStartReason.restartUninitializedSession', "A restart was requested for a session that never started"),
	[SessionStartReasonId.NewFolderNotebook]: () => localize2('positron.sessionStartReason.newFolderNotebook', "This notebook was created with a new folder from the Jupyter Notebook template"),
	[SessionStartReasonId.QuartoInlineOutput]: args => localize2('positron.sessionStartReason.quartoInlineOutput', "The Quarto document {0} needed a kernel for inline output", args.notebookFileName),
	[SessionStartReasonId.NotebookCellsExecuted]: args => localize2('positron.sessionStartReason.notebookCellsExecuted', "Cells in {0} were run with no kernel running", args.notebookFileName),
	[SessionStartReasonId.NotebookCodeFragmentExecuted]: args => localize2('positron.sessionStartReason.notebookCodeFragmentExecuted', "Selected code in {0} was run with no kernel", args.notebookFileName),
	[SessionStartReasonId.NotebookKernelSelected]: args => localize2('positron.sessionStartReason.notebookKernelSelected', "The {0} kernel was selected for {1}", args.runtimeName, args.notebookFileName),
	[SessionStartReasonId.NotebookKernelSelectionDeferred]: args => localize2('positron.sessionStartReason.notebookKernelSelectionDeferred', "The {0} kernel for {1} started once its interpreter was found", args.runtimeName, args.notebookFileName),
	[SessionStartReasonId.NotebookEditorOpened]: args => localize2('positron.sessionStartReason.notebookEditorOpened', "The {0} notebook was opened", args.notebookFileName),
	[SessionStartReasonId.NotebookEditorActivated]: args => localize2('positron.sessionStartReason.notebookEditorActivated', "{0}'s preview tab was kept open, or its background tab was brought to the front", args.notebookFileName),
	[SessionStartReasonId.NotebookKernelRestart]: args => localize2('positron.sessionStartReason.notebookKernelRestart', "Restart Kernel was used in {0} with no kernel running", args.notebookFileName),
	[SessionStartReasonId.ExtensionApiSelect]: () => localize2('positron.sessionStartReason.extensionApiSelect', "You started this interpreter"),
	[SessionStartReasonId.ExtensionApiStart]: () => localize2('positron.sessionStartReason.extensionApiStart', "An extension asked for this session through the Positron API"),
};

/**
 * Gets the values that fill in a start reason label. The saved description and
 * the console info popup both use this, so they always describe the same
 * session.
 *
 * @param runtime The runtime the session is for.
 * @param notebookUri The session's notebook, or undefined for a console session.
 * @param getExtensionName Gets the name to show for an extension ID.
 */
function getLabelArgs(runtime: ILanguageRuntimeMetadata, notebookUri: URI | undefined, getExtensionName: (extensionId: string) => string): ISessionStartReasonLabelArgs {
	return {
		languageName: runtime.languageName,
		extensionName: getExtensionName(runtime.extensionId.value),
		runtimeName: runtime.runtimeName,
		notebookFileName: notebookUri ? basename(notebookUri) : '',
	};
}

/**
 * Describes why a session is being started, for logs and for the session's
 * saved `startReason`. The description is in English and names extensions by
 * ID.
 *
 * @param startReason Why the session is being started.
 * @param runtime The runtime the session is for.
 * @param notebookUri The session's notebook, or undefined for a console session.
 * @returns The description.
 */
export function describeSessionStartReason(startReason: IRuntimeSessionStartReason, runtime: ILanguageRuntimeMetadata, notebookUri?: URI): string {
	return sessionStartReasonLabels[startReason.id](getLabelArgs(runtime, notebookUri, extensionId => extensionId)).original;
}

/**
 * Gets the user-facing label for why a session was started.
 *
 * @param session The session.
 * @param extensions The registered extensions, used to find extension display
 * names.
 * @returns The label, or undefined if the session has no start reason ID this
 * version knows, such as a session persisted before the ID existed.
 */
export function getSessionStartReasonLabel(session: Pick<ILanguageRuntimeSession, 'runtimeMetadata' | 'metadata'>, extensions: readonly IExtensionDescription[]): string | undefined {
	const { runtimeMetadata, metadata } = session;
	const createLabel = metadata.startReasonId && sessionStartReasonLabels[metadata.startReasonId];
	if (!createLabel) {
		return undefined;
	}
	const getDisplayName = (extensionId: string) => extensions.find(extension =>
		ExtensionIdentifier.equals(extension.identifier, extensionId))?.displayName ?? extensionId;
	return createLabel(getLabelArgs(runtimeMetadata, metadata.notebookUri, getDisplayName)).value;
}
