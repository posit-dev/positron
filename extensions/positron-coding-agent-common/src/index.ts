/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Agent-neutral helpers for Positron's built-in coding agent integrations.
// Nothing here imports `vscode` or `positron` at runtime: a require of
// either from outside an extension's folder gets an API without the
// extension's identity. Callers pass in the API objects instead.

export { getCommandLaunch, CommandLaunch } from './commandLaunch';
export { getErrorActionPrompt, PromptWorkspace } from './errorActionPrompt';
export { escapedLength, getErrorPrompt, truncateMiddle, ErrorPromptAction, ErrorPromptSource, PromptDocument, PromptL10n } from './errorPrompt';
export { showProblem, ProblemAction } from './problems';
export { registerWhileInstalled, Disposable, InstalledRegistration } from './registration';
export { openPromptTerminal, PromptTerminalOptions } from './terminal';
