/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { EXTENSION_ROOT_DIR } from '../constants';
import { RMetadataExtra } from '../r-installation';
import * as testKit from './kit';

suite('project R profile', () => {
	const script = path.join(EXTENSION_ROOT_DIR, 'resources', 'scripts', 'project-profile.R');

	/**
	 * Runs `code` with Rscript from `project/notebooks`, with the script set up
	 * to source `project/.Rprofile`, and returns the printed lines.
	 */
	async function runInNotebooksFolder(project: string, code: string): Promise<string[]> {
		const notebooks = path.join(project, 'notebooks');
		fs.mkdirSync(notebooks);

		const runtime = await testKit.getPreferredR();
		const rscript = (runtime.extraRuntimeData as RMetadataExtra).scriptpath;
		const output = execFileSync(rscript, ['-e', code], {
			cwd: notebooks,
			env: {
				...process.env,
				R_PROFILE_USER: script,
				POSITRON_R_PROJECT_PROFILE: path.join(project, '.Rprofile'),
			},
			encoding: 'utf8',
		});
		return output.trim().split(/\r?\n/);
	}

	test('sources the project profile from the project folder', async () => {
		await testKit.withDisposables(async (disposables) => {
			const [project, dirDisposable] = testKit.makeTempDir('project-profile-test');
			disposables.push(dirDisposable);

			// Like renv's, this profile sources a script relative to the project folder
			fs.mkdirSync(path.join(project, 'setup'));
			fs.writeFileSync(path.join(project, 'setup', 'activate.R'), 'activated <- TRUE\n');
			fs.writeFileSync(path.join(project, '.Rprofile'), 'source("setup/activate.R")\nprofile_dir <- getwd()\n');

			const [wd, profileDir, activated, envVars] = await runInNotebooksFolder(
				project,
				'cat(getwd(), profile_dir, activated, paste0("[", Sys.getenv("R_PROFILE_USER"), Sys.getenv("POSITRON_R_PROJECT_PROFILE"), "]"), sep = "\\n")'
			);

			assert.strictEqual(activated, 'TRUE');
			assert.strictEqual(testKit.normalizePath(profileDir), testKit.normalizePath(project));
			// Back in the notebook's folder once the profile has run
			assert.strictEqual(testKit.normalizePath(wd), testKit.normalizePath(path.join(project, 'notebooks')));
			// Unset so that child R processes don't inherit them
			assert.strictEqual(envVars, '[]');
		});
	});

	// renv's `activate.R` sources `R_PROFILE_USER` when its autoloader is
	// disabled, which must not loop back into the project profile
	test('is not sourced again by the project profile', async () => {
		await testKit.withDisposables(async (disposables) => {
			const [project, dirDisposable] = testKit.makeTempDir('project-profile-test');
			disposables.push(dirDisposable);

			fs.writeFileSync(path.join(project, '.Rprofile'), [
				'profile <- Sys.getenv("R_PROFILE_USER")',
				'if (nzchar(profile)) sys.source(profile, envir = globalenv())',
				'sourced <- if (exists("sourced")) sourced + 1 else 1',
				'',
			].join('\n'));

			const [sourced] = await runInNotebooksFolder(project, 'cat(sourced)');

			assert.strictEqual(sourced, '1');
		});
	});
});
