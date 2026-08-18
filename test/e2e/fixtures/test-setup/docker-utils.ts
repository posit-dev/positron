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
 *
 * `positron.assistant.models.overrides.msFoundry` declares the models the
 * provider exposes in the picker: `model-router` (the virtual routing model) and
 * the concrete `claude-sonnet-4-6` model. The foundry workbench suite exercises
 * both -- one test selects the router, the other the concrete model -- to cover
 * the model-overrides auth path for GA.
 *
 * NOTE: the `positron.assistant.models.overrides.msFoundry` key is expected to
 * change in the future; update this override (and the foundry suite) when it does.
 */
export const FOUNDRY_ASSISTANT_SETTINGS = {
	'positron.assistant.enable': true,
	'positron.assistant.provider.positAI.enable': false,
	'positron.assistant.models.overrides.msFoundry': [
		{ name: 'model-router', identifier: 'model-router' },
		{ name: 'claude-sonnet-4-6', identifier: 'claude-sonnet-4-6' },
	],
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
export function dockerSettingsOverrides(opts: { useLegacyNotebookEditor?: boolean; enableDataConnections?: boolean; enableFoundryAssistant?: boolean; extraSettings?: Record<string, unknown> }): object | undefined {
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
	// Merged last so a suite's own settings win over the options above.
	if (opts.extraSettings) {
		Object.assign(overrides, opts.extraSettings);
	}
	return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/**
 * The session user's AI provider catalog inside the container.
 *
 * These are user1's paths: the default Workbench shard runs the session as user1
 * (only the Azure shard uses a JIT user), so a suite needing the catalog on that
 * shard reads and writes here.
 */
const AI_CONFIG_DIR = '/home/user1/.posit/ai';
const PROVIDERS_CONFIG_PATH = `${AI_CONFIG_DIR}/providers.json`;
const PROVIDERS_CONFIG_BACKUP_PATH = `${PROVIDERS_CONFIG_PATH}.e2e.bak`;

/**
 * Turn the Posit AI provider on in the container's provider catalog.
 *
 * On Workbench the authentication extension disables Posit AI on first activation
 * so admins control AI access, by writing `providers.positai.enabled: false` into
 * this file (see `applyPwbPositAIDefault` in extensions/authentication/src/pwbDefaults.ts).
 * Core drops disabled providers before the provider modal renders, so with that
 * default in place the Posit AI tile is absent entirely and there is nothing for a
 * sign-in test to click.
 *
 * The catalog ranks this file above the legacy
 * `positron.assistant.provider.positAI.enable` setting the e2e fixtures write, so
 * that setting cannot undo the default -- the file has to say so, which is exactly
 * what an admin turning Posit AI on for Workbench does.
 *
 * Called before the session starts, which matters twice over. The extension writes
 * its default with `onlyIfUnset`, so it leaves an already-enabled value alone; and
 * the suite needs no window reload to pick the file up. A reload would be actively
 * harmful here: it re-probes cloud credential-chain metadata endpoints that are
 * unreachable from the container, and the resulting DNS stall makes the provider
 * modal's key validation abort on its own fixed budget
 * (KEY_VALIDATION_TIMEOUT_MS in extensions/authentication/src/constants.ts).
 */
export async function enablePositAIProviderInContainer(containerName: string): Promise<void> {
	const catalog = JSON.stringify({
		version: 1,
		providers: { positai: { enabled: true } },
	}, null, 2);

	// Write on the host then `docker cp` in, rather than heredoc-ing JSON through
	// nested shell quoting.
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-providers-'));
	const tmpProviders = path.join(tmpDir, 'providers.json');
	await fs.promises.writeFile(tmpProviders, catalog);

	try {
		await runDockerCommand(
			`docker exec ${containerName} mkdir -p ${AI_CONFIG_DIR}`,
			'Create the AI config directory'
		);
		// Back up whatever the container already had so teardown can put it back the
		// way the next suite sharing this container expects to find it.
		await runDockerCommand(
			`docker exec ${containerName} bash -lc 'if [ -f ${PROVIDERS_CONFIG_PATH} ]; then cp ${PROVIDERS_CONFIG_PATH} ${PROVIDERS_CONFIG_BACKUP_PATH}; fi'`,
			'Back up the existing provider catalog'
		);
		await runDockerCommand(
			`docker cp "${tmpProviders}" ${containerName}:${PROVIDERS_CONFIG_PATH}`,
			'Install the provider catalog'
		);
		// `docker cp` lands the file as root; the session runs as user1 and writes
		// back to this file when a provider's connection changes.
		await runDockerCommand(
			`docker exec ${containerName} chown -R user1 ${AI_CONFIG_DIR}`,
			'Set ownership of the AI config directory'
		);
	} finally {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	}
}

/**
 * Restore the provider catalog that `enablePositAIProviderInContainer` replaced.
 *
 * Leaving Posit AI enabled would carry into the other suites sharing this
 * container. Runs on session teardown, so the next suite's session reads the
 * restored file on startup and there is no reload to do.
 */
export async function restorePositAIProviderInContainer(containerName: string): Promise<void> {
	await runDockerCommand(
		`docker exec ${containerName} bash -lc 'if [ -f ${PROVIDERS_CONFIG_BACKUP_PATH} ]; then mv ${PROVIDERS_CONFIG_BACKUP_PATH} ${PROVIDERS_CONFIG_PATH}; else rm -f ${PROVIDERS_CONFIG_PATH}; fi'`,
		'Restore the original provider catalog'
	);
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
