/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isPastCodexTrustPrompt, readConfig } from './agentTrust';
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
	getUnavailableReason: async () => await getAgentLaunch('codex', CODEX_NPM_SCRIPT)
		? undefined
		: vscode.l10n.t('The codex command was not found on the PATH.'),
	canContinueChat: () => true,
	isAgentCommand: isCodexCommand,
	isPastTrustPrompt,
	startNew,
};

/** Start `codex` in a new terminal with the prompt. */
async function startNew(prompt: string): Promise<void> {
	const launch = await getAgentLaunch('codex', CODEX_NPM_SCRIPT);
	if (!launch) {
		throw new Error(vscode.l10n.t('Codex is not installed: `codex` was not found on the PATH.'));
	}
	startInTerminal(launch, prompt, { name: 'Codex' });
}

/** Whether Codex is past its folder-trust prompt in a directory. */
function isPastTrustPrompt(directory: string): boolean {
	const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
	return readConfig(path.join(codexHome, 'config.toml'), config => isPastCodexTrustPrompt(config, directory));
}
