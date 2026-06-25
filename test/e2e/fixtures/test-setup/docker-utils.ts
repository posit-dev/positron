/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ROOT_PATH } from './constants';

const execP = promisify(exec);

export type RunResult = {
	stdout: string;
	stderr: string;
	code?: number;      // best-effort exit code (populated on failure)
	signal?: NodeJS.Signals | null;
};

/**
 * Run a Docker command with error handling and logging
 */
export async function runDockerCommand(command: string, description: string): Promise<RunResult> {
	try {
		// Increase buffers for commands that produce lots of output (pull, build, logs, etc.)
		const { stdout, stderr } = await execP(command, {
			maxBuffer: 1024 * 1024 * 20, // 20 MB
			timeout: 0,                   // no timeout
			shell: '/bin/bash',           // so things like pipes && envs work consistently
		});
		return { stdout, stderr };
	} catch (err: any) {
		// exec throws with an Error that includes stdout/stderr and possibly signal/code
		const result: RunResult = {
			stdout: err.stdout ?? '',
			stderr: err.stderr ?? String(err.message ?? ''),
			code: typeof err.code === 'number' ? err.code : undefined,
			signal: err.signal ?? null,
		};
		// Re-throw with richer context but preserve captured output for callers
		const wrapped = new Error(
			`Failed to ${description.toLowerCase()} (exit ${result.code ?? 'unknown'}):\n${result.stderr}`
		);
		(wrapped as any).result = result;
		throw wrapped;
	}
}

/**
 * Settings that enable the Microsoft Foundry (msFoundry) assistant provider.
 *
 * On the Azure Workbench shard the provider is authenticated transparently via
 * Posit Workbench managed credentials (the authentication extension brokers an
 * `ms-foundry` session, gated on `posit.workbench.foundry.endpoint` being set),
 * so no interactive sign-in is required. positAI is disabled so the Foundry
 * model is the one exercised. Shared by the host-side `beforeApp` fixture and
 * `dockerSettingsOverrides` so the two paths cannot drift.
 */
export const FOUNDRY_ASSISTANT_SETTINGS = {
	'positron.assistant.enable': true,
	'positron.assistant.provider.positAI.enable': false,
	'positron.assistant.models.overrides.msFoundry': [{ name: 'model-router', identifier: 'model-router' }],
	'positron.assistant.provider.msFoundry.enable': true,
	'posit.workbench.foundry.endpoint': 'https://east2testai.services.ai.azure.com/',
	'authentication.foundry.baseUrl': 'https://east2testai.services.ai.azure.com/openai/v1',
} as const;

/**
 * Build the settings overrides driven by test options for the Docker apps.
 *
 * Mirrors the host-side `beforeApp` fixture: when a suite opts into the legacy
 * (VS Code) notebook editor, the Positron notebook editor is disabled; when a
 * suite opts into the Foundry assistant, its settings are merged in. Returns
 * `undefined` when there is nothing to override.
 */
export function dockerSettingsOverrides(opts: { useLegacyNotebookEditor?: boolean; enableDataConnections?: boolean; enableFoundryAssistant?: boolean }): object | undefined {
	const overrides: Record<string, unknown> = {};
	if (opts.useLegacyNotebookEditor) {
		overrides['positron.notebook.enabled'] = false;
	}
	if (opts.enableDataConnections) {
		overrides['dataConnections.enabled'] = true;
	}
	if (opts.enableFoundryAssistant) {
		Object.assign(overrides, FOUNDRY_ASSISTANT_SETTINGS);
	}
	return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/**
 * Copy merged settings (base + Docker overrides) to the container.
 *
 * `overrides` are merged last so they win over anything in the fixture files. The
 * Docker apps read settings from the container rather than the host `settingsFile`,
 * so test-driven settings (e.g. `useLegacyNotebookEditor`) must be threaded in here.
 */
export async function copyUserSettingsToContainer(
	containerName: string,
	userPath: string,
	settingsFiles: string[],
	overrides?: object
): Promise<void> {
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');

	// Merge settings from all provided files
	const mergedSettings: any = {};
	for (const settingsFile of settingsFiles) {
		const settingsPath = path.join(fixturesDir, settingsFile);
		if (fs.existsSync(settingsPath)) {
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
			Object.assign(mergedSettings, settings);
		}
	}

	// Test-driven overrides win over the fixture files
	if (overrides) {
		Object.assign(mergedSettings, overrides);
	}

	// Create temporary merged settings file
	const tempSettingsFile = path.join(fixturesDir, 'settings-merged.json');
	fs.writeFileSync(tempSettingsFile, JSON.stringify(mergedSettings, null, 2));

	try {
		// Copy to container
		const containerSettingsPath = `${userPath}settings.json`;
		await runDockerCommand(
			`docker cp ${tempSettingsFile} ${containerName}:${containerSettingsPath}`,
			'Copy settings to container'
		);
	} finally {
		// Clean up temporary file
		fs.unlinkSync(tempSettingsFile);
	}
}

/**
 * Copy keybindings to the container, adjusting for platform
 */
export async function copyKeyBindingsToContainer(
	containerName: string,
	userPath: string
): Promise<void> {
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const src = path.join(fixturesDir, 'keybindings.json');

	const original = await fs.promises.readFile(src, 'utf8');
	const modifier = process.platform === 'darwin' ? 'cmd' : 'ctrl';
	const adjusted = original.replace(/cmd/gi, modifier);

	const tmpFile = path.join(os.tmpdir(), `keybindings.${Date.now()}.json`);
	await fs.promises.writeFile(tmpFile, adjusted, 'utf8');

	const containerPath = `${userPath}keybindings.json`;

	await runDockerCommand(
		`docker cp "${tmpFile}" ${containerName}:"${containerPath}"`,
		'Copy keybindings to container'
	);

	// Cleanup
	await fs.promises.unlink(tmpFile);
}
