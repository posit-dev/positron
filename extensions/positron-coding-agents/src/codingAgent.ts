/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ErrorPrompt, formatFilePrompt } from './errorPrompt';

/** Directory for error details @-mentioned from prompts. */
const ERROR_DIR = path.join(os.tmpdir(), 'positron-coding-agents');

/** A coding agent that Fix and Explain can send errors to. */
export interface CodingAgent {
	/**
	 * Value of the agent in the ai.errorActions.target setting. Matches the
	 * agent's ID in positron-supervisor's MCP agent table, which is how the
	 * supervisor is asked whether the agent can reach Positron's MCP server.
	 */
	readonly id: string;

	/** Name shown in the UI. */
	readonly label: string;

	/** Whether the agent is installed and can take a prompt. */
	isAvailable(): boolean;

	/** Start a new session with the prompt. */
	start(prompt: ErrorPrompt): Promise<void>;
}

/** Format a single-line prompt, moving its body (if any) to a file it @-mentions. */
export async function formatPromptWithFile(prompt: ErrorPrompt): Promise<string> {
	return prompt.body ? formatFilePrompt(prompt, await writeBodyFile(prompt.body)) : prompt.lead;
}

/**
 * Write a prompt body to a temp file for a prompt to @-mention. Left in
 * place so the session can re-read it; the OS clears the temp directory.
 */
async function writeBodyFile(body: string): Promise<string> {
	await fs.mkdir(ERROR_DIR, { recursive: true });
	const bodyPath = path.join(ERROR_DIR, `error-${randomUUID()}.md`);
	await fs.writeFile(bodyPath, body, 'utf8');
	return bodyPath;
}
