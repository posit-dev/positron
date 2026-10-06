/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAgentLaunch } from './agentLaunch';
import { CodingAgent, startInTerminal } from './codingAgent';
import { isCodexCommand } from './foregroundProcess';

/** Codex's script in its npm package. */
const CODEX_NPM_SCRIPT = '@openai/codex/bin/codex.js';

/**
 * Codex, through its CLI. Its VS Code extension has no command that takes a
 * prompt; `codex <prompt>` starts an interactive session that sends it.
 */
export const codex: CodingAgent = {
	id: 'codex',
	label: 'Codex',
	isAvailable: () => getAgentLaunch('codex', CODEX_NPM_SCRIPT) !== undefined,
	isAgentCommand: isCodexCommand,
	startNew,
};

/** Start `codex` in a new terminal with the prompt. */
async function startNew(prompt: string): Promise<void> {
	const launch = getAgentLaunch('codex', CODEX_NPM_SCRIPT);
	if (!launch) {
		throw new Error(vscode.l10n.t('Codex is not installed: `codex` was not found on the PATH.'));
	}
	startInTerminal(launch, prompt, { name: 'Codex' });
}
