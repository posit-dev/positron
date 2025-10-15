/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec, spawnSync } from 'child_process';
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

const USER_AGENT = 'positron-python-tests';

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
const httpsGetAsync = (opts: string | https.RequestOptions) =>
    new Promise<IncomingMessage>((resolve, reject) => {
        const req = https.get(opts, resolve);
        req.once('error', reject);
    });

/**
 * Helper to execute a command and return the stdout and stderr.
 *
 * @param command The command to execute.
 * @param stdin Optional stdin to pass to the command.
 * @returns A promise that resolves with the stdout and stderr of the command.
 */
async function executeCommand(command: string, stdin?: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const process = exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
        if (stdin) {
            process.stdin!.write(stdin);
            process.stdin!.end();
        }
    });
}

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
    // Adapted from: https://github.com/posit-dev/positron/extensions/positron-r/scripts/install-kernel.ts.

    // We need a Github Personal Access Token (PAT) to download Positron. Because this is sensitive
    // information, there are a lot of ways to set it. We try the following in order:

    // (1) The GITHUB_PAT environment variable.
    // (2) The POSITRON_GITHUB_RO_PAT environment variable.
    // (3) The git config setting 'credential.https://api.github.com.token'.
    // (4) The git credential store.

    // (1) Get the GITHUB_PAT from the environment.
    let githubPat = process.env.GITHUB_PAT;
    let gitCredential = false;
    if (githubPat) {
        console.log('Using Github PAT from environment variable GITHUB_PAT.');
    } else {
        // (2) Try POSITRON_GITHUB_RO_PAT (it's what the build script sets)
        githubPat = process.env.POSITRON_GITHUB_RO_PAT;
        if (githubPat) {
            console.log('Using Github PAT from environment variable POSITRON_GITHUB_RO_PAT.');
        }
    }

    // (3) If no GITHUB_PAT is set, try to get it from git config. This provides a
    // convenient non-interactive way to set the PAT.
    if (!githubPat) {
        try {
            const { stdout } = await executeCommand('git config --get credential.https://api.github.com.token');
            githubPat = stdout.trim();
            if (githubPat) {
                console.log(`Using Github PAT from git config setting 'credential.https://api.github.com.token'.`);
            }
        } catch (error) {
            // We don't care if this fails; we'll try `git credential` next.
        }
    }

    // (4) If no GITHUB_PAT is set, try to get it from git credential.
    if (!githubPat) {
        // Explain to the user what's about to happen.
        console.log(
            `Attempting to retrieve a Github Personal Access Token from git in order\n` +
                `to download Positron. If you are prompted for a username and\n` +
                `password, enter your Github username and a Personal Access Token with the\n` +
                `'repo' scope. You can read about how to create a Personal Access Token here: \n` +
                `\n` +
                `https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens\n` +
                `\n` +
                `You can set a PAT later by rerunning this command and supplying the PAT at this prompt,\n` +
                `or by running 'git config credential.https://api.github.com.token YOUR_GITHUB_PAT'\n`,
        );
        const { stdout } = await executeCommand(
            'git credential fill',
            `protocol=https\nhost=github.com\npath=/repos/posit-dev/positron/releases\n`,
        );

        gitCredential = true;
        // Extract the `password = ` line from the output.
        const passwordLine = stdout.split('\n').find((line: string) => line.startsWith('password='));
        if (passwordLine) {
            [, githubPat] = passwordLine.split('=');
            console.log(`Using Github PAT returned from 'git credential'.`);
        }
    }

    if (!githubPat) {
        throw new Error(`No Github PAT was found. Unable to download Positron.`);
    }

    const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3.raw', // eslint-disable-line
        'User-Agent': USER_AGENT, // eslint-disable-line
    };
    // If we have a githubPat, set it for better rate limiting.
    if (githubPat) {
        headers.Authorization = `token ${githubPat}`;
    }

    const response = await httpsGetAsync({
        headers,
        method: 'GET',
        protocol: 'https:',
        hostname: 'api.github.com',
        path: `/repos/posit-dev/positron/releases`,
    });

    // Special handling for PATs originating from `git credential`.
    if (gitCredential && response.statusCode === 200) {
        // If the PAT hasn't been approved yet, do so now. This stores the credential in
        // the system credential store (or whatever `git credential` uses on the system).
        // Without this step, the user will be prompted for a username and password the
        // next time they try to download Positron.
        const { stdout, stderr } = await executeCommand(
            'git credential approve',
            `protocol=https\n` +
                `host=github.com\n` +
                `path=/repos/posit-dev/positron/releases\n` +
                `username=\n` +
                `password=${githubPat}\n`,
        );
        console.log(stdout);
        if (stderr) {
            console.warn(
                `Unable to approve PAT. You may be prompted for a username and ` +
                    `password the next time you download Positron.`,
            );
            console.error(stderr);
        }
    } else if (gitCredential && response.statusCode && response.statusCode > 400 && response.statusCode < 500) {
        // This handles the case wherein we got an invalid PAT from `git credential`. In this
        // case we need to clean up the PAT from the credential store, so that we don't
        // continue to use it.
        const { stdout, stderr } = await executeCommand(
            'git credential reject',
            `protocol=https\n` +
                `host=github.com\n` +
                `path=/repos/posit-dev/positron/releases\n` +
                `username=\n` +
                `password=${githubPat}\n`,
        );
        console.log(stdout);
        if (stderr) {
            console.error(stderr);
            throw new Error(
                `The stored PAT returned by 'git credential' is invalid, but\n` +
                    `could not be removed. Please manually remove the PAT from 'git credential'\n` +
                    `for the host 'github.com'`,
            );
        }
        throw new Error(
            `The PAT returned by 'git credential' is invalid. Positron cannot be\n` +
                `downloaded.\n\n` +
                `Check to be sure that your Personal Access Token:\n` +
                '- Has the `repo` scope\n' +
                '- Is not expired\n' +
                '- Has been authorized for the "posit-dev" organization on Github (Configure SSO)\n',
        );
    }

    // Get releases from the Positron CDN instead of GitHub releases
    const cdnResponse = await httpsGetAsync({
        headers: {
            'User-Agent': USER_AGENT,
        },
        method: 'GET',
        protocol: 'https:',
        hostname: 'cdn.posit.co',
        path: '/positron/dailies/mac/universal/releases.json',
    });

    let cdnResponseBody = '';
    cdnResponse.on('data', (chunk) => {
        cdnResponseBody += chunk;
    });

    const cdnRelease = await new Promise<any>((resolve, reject) => {
        cdnResponse.once('end', async () => {
            if (cdnResponse.statusCode !== 200) {
                reject(
                    new Error(
                        `Failed to download releases from CDN: HTTP ${cdnResponse.statusCode}\n\n${cdnResponseBody}`,
                    ),
                );
            } else {
                resolve(JSON.parse(cdnResponseBody));
            }
        });
    });

    if (!cdnRelease) {
        throw new Error(`Unexpected response from CDN:\n\n${cdnResponseBody}`);
    }

    const { platform } = process;
    let suffix: string;
    switch (platform) {
        case 'darwin':
            suffix = '.dmg';
            break;
        default: {
            throw new Error(`Unsupported platform: ${platform}.`);
        }
    }

    const version = cdnRelease.version;
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

    let fileName: string;
    let url: URL | undefined;
    switch (platform) {
        case 'darwin':
            fileName = `Positron-${version}-universal${suffix}`;
            url = new URL(`https://cdn.posit.co/positron/dailies/mac/universal/${fileName}`);
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }

    console.log(`Downloading Positron for ${platform} from ${url.href}`);
    // Use separate headers for downloading the Positron binary.
    const dlHeaders: Record<string, string> = {
        Accept: 'application/octet-stream',
        'User-Agent': USER_AGENT,
    };
    const dlRequestOptions: https.RequestOptions = {
        headers: dlHeaders,
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
    const downloadPath = path.join(tempDir, fileName);
    try {
        const writer = fs.createWriteStream(downloadPath);
        dlResponse.pipe(writer);
        await new Promise<void>((resolve, reject) => {
            writer.once('finish', () => resolve());
            writer.once('error', (err) => reject(err));
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
