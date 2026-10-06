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
	/**
	 * The extension that asked for the session, such as "R", or empty if no
	 * extension did or the session was saved before it was recorded.
	 */
	readonly requestingExtensionName: string;
}

/**
 * The label shared by the two start reasons for a file being opened in the
 * session's language. The reasons stay separate so the two code paths can be
 * told apart.
 */
const languageFileOpenedLabel = (args: ISessionStartReasonLabelArgs) =>
	localize2('positron.sessionStartReason.languageFileOpened', "A file written in {0} was opened", args.languageName);

/**
 * The label shared by two of the start reasons for an extension recommending
 * the session's runtime at startup. The reasons stay separate so the two code
 * paths can be told apart.
 */
const extensionRecommendedRuntimeLabel = (args: ISessionStartReasonLabelArgs) =>
	localize2('positron.sessionStartReason.extensionRecommendedRuntime', "The {0} extension recommended this interpreter for this workspace", args.extensionName);

/**
 * User-facing labels for each session start reason.
 */
const sessionStartReasonLabels: Record<SessionStartReasonId, (args: ISessionStartReasonLabelArgs) => ILocalizedString> = {
	[SessionStartReasonId.AffiliatedRuntime]: () => localize2('positron.sessionStartReason.affiliatedRuntime', "Positron started the last interpreter used in this workspace"),
	[SessionStartReasonId.AffiliatedRuntimeAtRegistration]: () => localize2('positron.sessionStartReason.affiliatedRuntimeAtRegistration', "Positron found the last interpreter used in this workspace and started it"),
	[SessionStartReasonId.ExtensionRequestedImmediateStart]: extensionRecommendedRuntimeLabel,
	[SessionStartReasonId.ExtensionRequestedStartAtRegistration]: args => localize2('positron.sessionStartReason.extensionRequestedStartAtRegistration', "The {0} extension found this interpreter and recommended it for this workspace", args.extensionName),
	[SessionStartReasonId.ExtensionRecommendedRuntime]: extensionRecommendedRuntimeLabel,
	[SessionStartReasonId.StartupBehaviorAlways]: args => localize2('positron.sessionStartReason.startupBehaviorAlways', "Startup Behavior is set to \"Always\" for {0}", args.languageName),
	[SessionStartReasonId.StartupBehaviorAlwaysAllLanguages]: () => localize2('positron.sessionStartReason.startupBehaviorAlwaysAllLanguages', "Startup Behavior is set to \"Always\""),
	[SessionStartReasonId.LanguageFileOpenedAtRegistration]: languageFileOpenedLabel,
	[SessionStartReasonId.LanguageFileOpened]: languageFileOpenedLabel,
	[SessionStartReasonId.UserSelectedRuntime]: () => localize2('positron.sessionStartReason.userSelectedRuntime', "You selected this interpreter"),
	[SessionStartReasonId.UserStartedAgentSession]: () => localize2('positron.sessionStartReason.userStartedAgentSession', "You started an agent console session for this interpreter"),
	[SessionStartReasonId.NewConsoleCommand]: () => localize2('positron.sessionStartReason.newConsoleCommand', "A command requested a new console for this interpreter"),
	[SessionStartReasonId.DuplicatedConsoleSession]: () => localize2('positron.sessionStartReason.duplicatedConsoleSession', "You duplicated a console"),
	[SessionStartReasonId.DuplicatedNotebookSession]: () => localize2('positron.sessionStartReason.duplicatedNotebookSession', "You started a new console with a notebook's interpreter"),
	[SessionStartReasonId.CodeExecutedWithoutSession]: args => args.requestingExtensionName ?
		localize2('positron.sessionStartReason.codeExecutedWithoutSessionByExtension', "The {0} extension ran code with no {1} console open", args.requestingExtensionName, args.languageName) :
		localize2('positron.sessionStartReason.codeExecutedWithoutSession', "Code was run with no {0} console open", args.languageName),
	[SessionStartReasonId.UserRanCodeWithoutSession]: args => localize2('positron.sessionStartReason.userRanCodeWithoutSession', "You ran code with no {0} console open", args.languageName),
	[SessionStartReasonId.AssistantRanCodeWithoutSession]: args => localize2('positron.sessionStartReason.assistantRanCodeWithoutSession', "An AI assistant ran code with no {0} console open", args.languageName),
	[SessionStartReasonId.RestartUninitializedSession]: args => args.requestingExtensionName ?
		localize2('positron.sessionStartReason.restartUninitializedSessionByExtension', "The {0} extension requested a restart before this interpreter had started", args.requestingExtensionName) :
		localize2('positron.sessionStartReason.restartUninitializedSession', "A restart was requested before this interpreter had started"),
	[SessionStartReasonId.NewFolderNotebook]: () => localize2('positron.sessionStartReason.newFolderNotebook', "You created a new folder from the Jupyter Notebook template"),
	[SessionStartReasonId.QuartoInlineOutput]: args => localize2('positron.sessionStartReason.quartoInlineOutput', "{0} needed a kernel for inline output", args.notebookFileName),
	[SessionStartReasonId.NotebookCellsExecuted]: args => localize2('positron.sessionStartReason.notebookCellsExecuted', "Cells in {0} were run with no kernel running", args.notebookFileName),
	[SessionStartReasonId.NotebookCodeFragmentExecuted]: args => localize2('positron.sessionStartReason.notebookCodeFragmentExecuted', "Selected code in {0} was run with no kernel running", args.notebookFileName),
	[SessionStartReasonId.NotebookKernelSelected]: args => localize2('positron.sessionStartReason.notebookKernelSelected', "The {0} kernel was selected for {1}", args.runtimeName, args.notebookFileName),
	[SessionStartReasonId.NotebookKernelSelectionDeferred]: args => localize2('positron.sessionStartReason.notebookKernelSelectionDeferred', "The {0} kernel was selected for {1} and started once Positron found it", args.runtimeName, args.notebookFileName),
	[SessionStartReasonId.NotebookEditorOpened]: args => localize2('positron.sessionStartReason.notebookEditorOpened', "{0} was opened", args.notebookFileName),
	[SessionStartReasonId.NotebookEditorActivated]: args => localize2('positron.sessionStartReason.notebookEditorActivated', "You switched to {0} or kept its preview tab open", args.notebookFileName),
	[SessionStartReasonId.NotebookKernelRestart]: args => localize2('positron.sessionStartReason.notebookKernelRestart', "Restart Kernel was used in {0} with no kernel running", args.notebookFileName),
	[SessionStartReasonId.ExtensionApiSelect]: args => args.requestingExtensionName ?
		localize2('positron.sessionStartReason.extensionApiSelectByExtension', "The {0} extension selected this interpreter", args.requestingExtensionName) :
		localize2('positron.sessionStartReason.extensionApiSelect', "An extension selected this interpreter"),
	[SessionStartReasonId.ExtensionApiStart]: args => args.requestingExtensionName ?
		localize2('positron.sessionStartReason.extensionApiStartByExtension', "The {0} extension started this interpreter", args.requestingExtensionName) :
		localize2('positron.sessionStartReason.extensionApiStart', "An extension started this interpreter"),
};

/**
 * Gets the values that fill in a start reason label. The saved description and
 * the console info popup both use this, so they always describe the same
 * session.
 *
 * @param runtime The runtime the session is for.
 * @param notebookUri The session's notebook, or undefined for a console session.
 * @param requestingExtensionId The extension that asked for the session, if any.
 * @param getExtensionName Gets the name to show for an extension ID.
 */
function getLabelArgs(runtime: ILanguageRuntimeMetadata, notebookUri: URI | undefined, requestingExtensionId: string | undefined, getExtensionName: (extensionId: string) => string): ISessionStartReasonLabelArgs {
	// Runtime metadata can come from storage, so a missing field must not stop
	// a session from starting.
	const extensionId = runtime.extensionId?.value;
	return {
		languageName: runtime.languageName ?? '',
		extensionName: extensionId ? getExtensionName(extensionId) : '',
		runtimeName: runtime.runtimeName ?? '',
		notebookFileName: notebookUri ? basename(notebookUri) : '',
		requestingExtensionName: requestingExtensionId ? getExtensionName(requestingExtensionId) : '',
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
	// A session saved by a newer version can carry an ID this version doesn't know.
	if (!Object.hasOwn(sessionStartReasonLabels, startReason.id)) {
		return startReason.id;
	}
	return sessionStartReasonLabels[startReason.id](getLabelArgs(runtime, notebookUri, startReason.requestingExtensionId, extensionId => extensionId)).original;
}

/**
 * Describes why a session is being started, for log lines and errors. Several
 * start reasons share a description, so this adds the start reason ID, and the
 * requesting extension if there is one, so the log says which code path ran.
 *
 * @param startReason Why the session is being started.
 * @param runtime The runtime the session is for.
 * @param notebookUri The session's notebook, or undefined for a console session.
 * @returns The description.
 */
export function describeSessionStartReasonForLog(startReason: IRuntimeSessionStartReason, runtime: ILanguageRuntimeMetadata, notebookUri?: URI): string {
	const ids = [`startReasonId: ${startReason.id}`];
	if (startReason.requestingExtensionId) {
		ids.push(`requestingExtension: ${startReason.requestingExtensionId}`);
	}
	return `${describeSessionStartReason(startReason, runtime, notebookUri)} [${ids.join(', ')}]`;
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
	// The ID comes from storage, so make sure it names a label and not a
	// property every object has, such as `toString`.
	if (!metadata.startReasonId || !Object.hasOwn(sessionStartReasonLabels, metadata.startReasonId)) {
		return undefined;
	}
	const createLabel = sessionStartReasonLabels[metadata.startReasonId];
	const getDisplayName = (extensionId: string) => extensions.find(extension =>
		ExtensionIdentifier.equals(extension.identifier, extensionId))?.displayName ?? extensionId;
	return createLabel(getLabelArgs(runtimeMetadata, metadata.notebookUri, metadata.requestingExtensionId, getDisplayName)).value;
}
