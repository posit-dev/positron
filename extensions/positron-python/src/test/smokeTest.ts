// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// Must always be on top to setup expected env.
process.env.VSC_PYTHON_SMOKE_TEST = '1';

import { spawn } from 'child_process';
import * as fs from '../client/common/platform/fs-paths';
import * as glob from 'glob';
import * as path from 'path';
import { unzip } from './common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, SMOKE_TEST_EXTENSIONS_DIR } from './constants';

// --- Start Positron ---
import { getUserDataDir } from './positron/constants';
// --- End Positron ---

class TestRunner {
    public async start() {
        console.log('Start Test Runner');
        await this.enableLanguageServer();
        // --- Start Positron ---
        // Although experiments are already enabled for smoke tests in src/test/initialize.ts:initialize,
        // that approach doesn't work for us since we eagerly activate the extension, and the experiment
        // service is constructed before the settings are updated. We need to enable experiments here
        // by writing to the test user settings file before the test script (src/test/index.ts) is started.
        await this.enableExperiments();
        // --- End Positron ---
        await this.extractLatestExtension(SMOKE_TEST_EXTENSIONS_DIR);
        await this.launchSmokeTests();
    }
    private async launchSmokeTests() {
        const env: Record<string, {}> = {
            VSC_PYTHON_SMOKE_TEST: '1',
            CODE_EXTENSIONS_PATH: SMOKE_TEST_EXTENSIONS_DIR,
        };

        await this.launchTest(env);
    }
    private async enableLanguageServer() {
        // When running smoke tests, we won't have access to unbundled files.
        const settings = `{ "python.languageServer": "Jedi" }`;
        await fs.ensureDir(
            path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'smokeTests', '.vscode'),
        );
        await fs.writeFile(
            path.join(
                EXTENSION_ROOT_DIR_FOR_TESTS,
                'src',
                'testMultiRootWkspc',
                'smokeTests',
                '.vscode',
                'settings.json',
            ),
            settings,
        );
    }
    // --- Start Positron ---
    private async enableExperiments() {
        const settingsFile = path.join(await getUserDataDir(), 'User', 'settings.json');

        await fs.mkdir(path.dirname(settingsFile));

        let settings: Record<string, {}> = {};
        if (await fs.pathExists(settingsFile)) {
            settings = JSON.parse(await fs.readFile(settingsFile, 'utf-8'));
        }

        settings = { ...settings, 'python.experiments.optInto': ['All'] };
        await fs.writeFile(settingsFile, JSON.stringify(settings));
    }
    // --- End Positron ---
    private async launchTest(customEnvVars: Record<string, {}>) {
        console.log('Launch tests in test runner');
        await new Promise<void>((resolve, reject) => {
            const env: Record<string, string> = {
                TEST_FILES_SUFFIX: 'smoke.test',
                IS_SMOKE_TEST: 'true',
                CODE_TESTS_WORKSPACE: path.join(
                    EXTENSION_ROOT_DIR_FOR_TESTS,
                    'src',
                    'testMultiRootWkspc',
                    'smokeTests',
                ),
                ...process.env,
                ...customEnvVars,
            };
            const proc = spawn('node', [path.join(__dirname, 'standardTest.js')], {
                cwd: EXTENSION_ROOT_DIR_FOR_TESTS,
                env,
            });
            proc.stdout.pipe(process.stdout);
            proc.stderr.pipe(process.stderr);
            proc.on('error', reject);
            proc.on('exit', (code) => {
                console.log(`Tests Exited with code ${code}`);
                if (code === 0) {
                    resolve();
                } else {
                    reject(`Failed with code ${code}.`);
                }
            });
        });
    }

    private async extractLatestExtension(targetDir: string): Promise<void> {
        const extensionFile = await new Promise<string>((resolve, reject) =>
            glob.default('*.vsix', (ex, files) => (ex ? reject(ex) : resolve(files[0]))),
        );
        await unzip(extensionFile, targetDir);
    }
}

new TestRunner().start().catch((ex) => {
    console.error('Error in running Smoke Tests', ex);
    // Exit with non zero exit code, so CI fails.
    process.exit(1);
});
