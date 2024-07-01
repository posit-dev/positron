/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import * as fs from 'fs-extra';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { defaultCachePath } from '@vscode/test-electron/out/download';
import { TestOptions } from '@vscode/test-electron/out/runTest';
import { runTests as vscodeRunTests } from '@vscode/test-electron';
import { getUserDataDir } from './constants';

const rmrf = require('rimraf');

const COMPLETE_FILE_NAME = 'is-complete';

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
const httpsGetAsync = (opts: string | https.RequestOptions) =>
    new Promise<IncomingMessage>((resolve, reject) => {
        const req = https.get(opts, resolve);
        req.once('error', reject);
    });

/**
 * Helper to execute a command (quoting arguments) and return stdout.
 *
 * @param command The command to execute.
 * @param args The arguments to pass to the command.
 * @returns The stdout of the command.
 */
function spawnSyncCommand(command: string, args?: string[]): string {
    const result = spawnSync(command, args);
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`Command failed: ${command}, stderr: ${result.stderr.toString()}`);
    }
    return result.stdout.toString();
}

/**
 * Download and unzip the latest Positron release to the vscode test cache directory.
 * Roughly equivalent to `downloadAndUnzipVSCode` from `@vscode/test-electron`.
 */
export async function downloadAndUnzipPositron(): Promise<{ version: string; executablePath: string }> {

    const response = await httpsGetAsync({
        headers: {
            Accept: 'application/vnd.github.v3.raw', // eslint-disable-line
            'User-Agent': 'positron-python-tests', // eslint-disable-line
        },
        method: 'GET',
        protocol: 'https:',
        hostname: 'api.github.com',
        path: `/repos/posit-dev/positron/releases`,
    });

    let responseBody = '';
    response.on('data', (chunk) => {
        responseBody += chunk;
    });

    const releases = await new Promise((resolve, reject) => {
        response.once('end', async () => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download Positron: HTTP ${response.statusCode}\n\n${responseBody}`));
            } else {
                resolve(JSON.parse(responseBody));
            }
        });
    });

    if (!Array.isArray(releases)) {
        throw new Error(`Unexpected response from Github:\n\n${responseBody}`);
    }
    const release = releases[0];
    if (!release) {
        throw new Error(`Unexpected error, no releases found.`);
    }

    const { platform } = process;
    let suffix: string;
    switch (platform) {
        case 'darwin':
            suffix = '.dmg';
            break;
        case 'linux':
            suffix = '.deb';
            break;
        case 'win32':
            suffix = '.exe';
            break;
        default: {
            throw new Error(`Unsupported platform: ${platform}.`);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asset = release.assets.find((a: any) => a.name.endsWith(suffix));
    if (!asset) {
        throw new Error(`No asset found with suffix ${suffix} for platform ${platform}`);
    }
    const version = release.tag_name;
    console.log(`Using ${version} build of Positron`);

    // Exit early if the version has already been downloaded and unzipped.
    const installDir = path.join(defaultCachePath, `positron-${platform}`);
    const completeFile = path.join(installDir, COMPLETE_FILE_NAME);

    let executablePath: string;
    switch (platform) {
        case 'darwin':
            executablePath = path.join(installDir, 'Positron.app', 'Contents', 'MacOS', 'Electron');
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }

    if (await fs.pathExists(completeFile)) {
        const existingVersion = (await fs.readFile(completeFile, 'utf-8')).trim();
        if (existingVersion === version) {
            console.log(`Found existing install in ${installDir}`);
            return { version, executablePath };
        }
    }

    console.log(`Downloading Positron for ${platform} from ${asset.url}`);
    const url = new URL(asset.url);
    const dlRequestOptions: https.RequestOptions = {
        headers: {
            Accept: 'application/octet-stream', // eslint-disable-line
            'User-Agent': 'positron-python-tests', // eslint-disable-line
        },
        method: 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
    };

    let dlResponse = await httpsGetAsync(dlRequestOptions);
    while (dlResponse.statusCode === 302 && dlResponse.headers.location) {
        // Follow redirects.
        dlResponse = await httpsGetAsync(dlResponse.headers.location);
    }

    // Download to a temporary file.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'positron-'));
    const fileName = asset.name;
    const downloadPath = path.join(tempDir, fileName);
    try {
        const writer = fs.createWriteStream(downloadPath);
        dlResponse.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.once('finish', resolve);
            writer.once('error', reject);
        });

        if (!(await fs.pathExists(installDir))) {
            await fs.mkdir(installDir, { recursive: true });
        }

        if (platform === 'darwin') {
            console.log(`Installing Positron to ${installDir}`);

            // Mount the dmg.
            spawnSyncCommand('hdiutil', ['attach', '-quiet', downloadPath]);

            const volumeMount = path.join('/Volumes', path.basename(fileName, '.dmg'));
            try {
                const appPath = path.join(volumeMount, 'Positron.app');
                const targetPath = path.join(installDir, 'Positron.app');

                // Copy the app to the install directory.
                rmrf.sync(targetPath);
                await fs.copy(appPath, targetPath);
            } finally {
                // Unmount the dmg.
                spawnSyncCommand('hdiutil', ['detach', '-quiet', volumeMount]);
            }

            // Mark as complete for subsequent runs.
            await fs.writeFile(completeFile, version.trim(), 'utf-8');

            return { version, executablePath };
        }
    } finally {
        fs.unlink(downloadPath);
    }

    throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Wrap `@vscode/test-electron/runTests` to support Positron.
 */
export async function runTests(options: TestOptions): Promise<number> {
    const { version, executablePath: vscodeExecutablePath } = await downloadAndUnzipPositron();

    // Run tests with a temporary user data dir to ensure no leftover state.
    // This is also necessary for upstream debugger tests on CI since otherwise the debugger tests
    // fail due to the path being too long.
    options.launchArgs = options.launchArgs || [];
    options.launchArgs.push('--user-data-dir', await getUserDataDir());

    return vscodeRunTests({ version, vscodeExecutablePath, ...options });
}
