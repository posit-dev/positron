/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '../../_test.setup.js';
import { Application } from '../../../infra/index.js';

/**
 * Throwaway folders for interpreter startup tests. Each folder is opened in a
 * new Positron launch, so its saved interpreter (workspace storage) starts out
 * empty, and its `.vscode/settings.json` carries the scenario's startup
 * settings instead of the shared user settings.
 */
export class StartupFolders {
	private readonly root: string;

	constructor(private readonly app: Application, suiteName: string) {
		// Outside the default workspace, so its R and Python files can't affect these launches.
		this.root = path.join(path.dirname(app.workspacePathOrFolder), `${suiteName}-${Date.now()}`);
	}

	/** Creates a folder with the given files and, if given, a `.vscode/settings.json`. */
	async folder(name: string, options: { files?: Record<string, string>; settings?: Record<string, unknown> } = {}): Promise<string> {
		const folder = path.join(this.root, name);
		await fs.promises.mkdir(folder, { recursive: true });
		for (const [file, content] of Object.entries(options.files ?? {})) {
			await fs.promises.writeFile(path.join(folder, file), content);
		}
		if (options.settings) {
			await writeFolderSettings(folder, options.settings);
		}
		return folder;
	}

	/** Quits Positron and launches it again in the folder. */
	async launch(folder: string): Promise<void> {
		await test.step(`Launch in ${path.basename(folder)}`, async () => {
			await this.app.restart({ workspaceOrFolder: folder });
		});
	}

	/** Deletes the folders. The app fixture stops Positron right after. */
	async remove(): Promise<void> {
		await fs.promises.rm(this.root, { recursive: true, force: true });
	}
}

/** Writes (or replaces) the folder's `.vscode/settings.json`. */
export async function writeFolderSettings(folder: string, settings: Record<string, unknown>): Promise<void> {
	const vscodeDir = path.join(folder, '.vscode');
	await fs.promises.mkdir(vscodeDir, { recursive: true });
	await fs.promises.writeFile(path.join(vscodeDir, 'settings.json'), JSON.stringify(settings, null, '\t'));
}

/**
 * Waits for this launch's interpreter discovery to finish, then checks that
 * no console started.
 */
export async function expectNoSession(app: Application): Promise<void> {
	await test.step('Expect no session to start', async () => {
		const { console, sessions } = app.workbench;
		await sessions.expectDiscoveryToComplete();
		await sessions.expectSessionCountToBe(0);
		await expect(console.emptyConsole).toBeVisible();
	});
}

/** Checks that exactly one console is running and ready, and which interpreter and start reason it has. */
export async function expectSingleSession(app: Application, expected: { name: string | RegExp; startReasonId?: string | RegExp }): Promise<void> {
	await test.step(`Expect a single ${expected.name} session`, async () => {
		const { sessions } = app.workbench;
		await sessions.expectSessionCountToBe(1);
		// Ready, so a test that closes the console next shuts it down rather than discarding a session that never started.
		await expect(async () => {
			const { name, state, startReasonId } = await sessions.getMetadata();
			expect(state).toBe('idle');
			expect(name).toMatch(expected.name);
			if (expected.startReasonId instanceof RegExp) {
				expect(startReasonId).toMatch(expected.startReasonId);
			} else if (expected.startReasonId) {
				expect(startReasonId).toBe(expected.startReasonId);
			}
		}).toPass({ timeout: 90000 });
	});
}

/** The version in a `POSITRON_*_VER_SEL` value, without its source: `3.13.0 (Pyenv)` gives `3.13.0`. */
export function versionOf(envValue: string | undefined): string {
	return (envValue ?? '').trim().split(/\s+/)[0];
}

export const PYTHON_NAME = /^Python \d/;
