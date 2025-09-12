/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable global-require */
/* eslint-disable arrow-body-style */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import decompress from 'decompress';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { IncomingMessage } from 'http';
import { promisify } from 'util';
import { platform, arch } from 'os';

/**
 * This script is a forked copy of the `install-kernel` script from the
 * positron-r and positron-supervisor extension; it is responsible for downloading
 * a copy of the Python Environment Tools repo and/or using a local version.
 *
 * In the future, we could consider some way to share this script between the
 * extensions (note that some URLs, paths, and messages are different) or
 * provide a shared library for downloading and installing binaries from Github
 * releases.
 */

// Promisify some filesystem functions.
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = async (filePath: string, data: any) => {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    return fs.promises.writeFile(filePath, data);
};
const existsAsync = promisify(fs.exists);

// Create a promisified version of https.get. We can't use the built-in promisify
// because the callback doesn't follow the promise convention of (error, result).
export const httpsGetAsync = (opts: https.RequestOptions): Promise<IncomingMessage> => {
    return new Promise<IncomingMessage>((resolve, reject) => {
        const req = https.get(opts, resolve);
        req.once('error', reject);
    });
};

/**
 * Gets the version of Python Environment Tool specified in package.json.
 *
 * @returns The version of Python Environment Tool specified in package.json, or null if it cannot be determined.
 */
async function getVersionFromPackageJson(): Promise<string | null> {
    try {
        const packageJson = JSON.parse(await readFileAsync('package.json', 'utf-8'));
        return packageJson.positron.externalDependencies?.pet || null;
    } catch (error) {
        throw new Error(`Error reading package.json: ${error}`);
    }
}

/**
 * Gets the version of Python Environment Tools installed locally by reading a `VERSION` file that's written
 * by this `install-kernel` script.
 *
 * @returns The version of Python Environment Tool installed locally, or null if PET is not installed.
 */
async function getLocalPetVersion(): Promise<string | null> {
    const versionFile = path.join('resources', 'pet', 'VERSION');
    try {
        const petExists = await existsAsync(versionFile);
        if (!petExists) {
            return null;
        }
        return readFileAsync(versionFile, 'utf-8');
    } catch (error) {
        throw new Error(`Error determining Python Environment Tools version: ${error}`);
    }
}

/**
 * Helper to execute a command and return the stdout and stderr.
 *
 * @param command The command to execute.
 * @param stdin Optional stdin to pass to the command.
 * @returns A promise that resolves with the stdout and stderr of the command.
 */
async function executeCommand(command: string, stdin?: string): Promise<{ stdout: string; stderr: string }> {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
        const process = exec(command, (error: any, stdout: string, stderr: string) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
        if (stdin) {
            process.stdin.write(stdin);
            process.stdin.end();
        }
    });
}

/**
 * Downloads the specified version of Python Environment Tool and replaces the local directory.
 *
 * @param version The version of Python Environment Tool to download.
 * @param githubPat An optional Github Personal Access Token with the appropriate rights
 *  to download the release.
 */
async function downloadAndReplacePet(version: string, githubPat: string | undefined): Promise<void> {
    try {
        const headers: Record<string, string> = {
            Accept: 'application/vnd.github.v3.raw', // eslint-disable-line
            'User-Agent': 'positron-pet-downloader', // eslint-disable-line
        };
        // If we have a githubPat, set it for better rate limiting.
        if (githubPat) {
            headers.Authorization = `token ${githubPat}`;
        }
        const requestOptions: https.RequestOptions = {
            headers,
            method: 'GET',
            protocol: 'https:',
            hostname: 'api.github.com',
            path: `/repos/posit-dev/positron-pet-builds/releases`,
        };

        const response = (await httpsGetAsync(requestOptions as any)) as any;

        let responseBody = '';

        response.on('data', (chunk: any) => {
            responseBody += chunk;
        });

        response.on('end', async () => {
            if (response.statusCode !== 200) {
                throw new Error(
                    `Failed to download Python Environment Tool: HTTP ${response.statusCode}\n\n ${responseBody}`,
                );
            }
            const releases = JSON.parse(responseBody);
            if (!Array.isArray(releases)) {
                throw new Error(`Unexpected response from Github:\n\n ${responseBody}`);
            }
            const release = releases.find((asset: any) => asset.tag_name === version);
            if (!release) {
                throw new Error(`Could not find Python Environment Tool ${version} in the releases.`);
            }
            let os: string;
            switch (platform()) {
                case 'win32':
                    os = 'windows-x64';
                    break;
                case 'darwin':
                    os = 'darwin-universal';
                    break;
                case 'linux':
                    os = arch() === 'arm64' ? 'linux-arm64' : 'linux-x64';
                    break;
                default: {
                    throw new Error(`Unsupported platform ${platform()}.`);
                }
            }

            const assetName = `pet-${version}-${os}.zip`;
            const asset = release.assets.find((asset: any) => asset.name === assetName);
            if (!asset) {
                throw new Error(`Could not find Python Environment Tool with asset name ${assetName} in the release.`);
            }
            console.log(`Downloading Python Environment Tool ${version} from ${asset.url}...`);
            const url = new URL(asset.url);
            // Reset the Accept header to download the asset.
            headers.Accept = 'application/octet-stream';
            const requestOptions: https.RequestOptions = {
                headers,
                method: 'GET',
                protocol: url.protocol,
                hostname: url.hostname,
                path: url.pathname,
            };

            let dlResponse = (await httpsGetAsync(requestOptions)) as any;
            while (dlResponse.statusCode === 302) {
                // Follow redirects.
                dlResponse = (await httpsGetAsync(dlResponse.headers.location)) as any;
            }
            let binaryData = Buffer.alloc(0);

            // Ensure we got a 200 response on the final request.
            if (dlResponse.statusCode !== 200) {
                throw new Error(`Failed to download Pet: HTTP ${dlResponse.statusCode}`);
            }

            dlResponse.on('data', (chunk: any) => {
                binaryData = Buffer.concat([binaryData, chunk]);
            });
            dlResponse.on('end', async () => {
                const extensionParent = path.dirname(__dirname);
                const petDir = path.join(extensionParent, 'python-env-tools');

                // Ensure we got some bytes. Less than 1024 bytes is probably
                // an error; none of our assets are under 1mb
                if (binaryData.length < 1024) {
                    // Log the data we did get
                    console.error(binaryData.toString('utf-8'));
                    throw new Error(
                        `Binary data is too small (${binaryData.length} bytes); download probably failed.`);
                }

                // Create the resources/pet directory if it doesn't exist.
                if (!(await existsAsync(petDir))) {
                    await fs.promises.mkdir(petDir);
                }

                console.log(`Successfully downloaded PET ${version} (${binaryData.length} bytes).`);
                const zipFileDest = path.join(petDir, 'pet.zip');
                await writeFileAsync(zipFileDest, binaryData);

                await decompress(zipFileDest, petDir, { strip: 1 }).then(() => {
                    console.log(`Successfully unzipped Python Environment Tool ${version}.`);
                });

                // Clean up the zipfile.
                await fs.promises.unlink(zipFileDest);

                // Write a VERSION file with the version number.
                await writeFileAsync(path.join('resources', 'pet', 'VERSION'), version);
            });
        });
    } catch (error) {
        throw new Error(`Error downloading Pet: ${error}`);
    }
}

async function main() {
    // Before we do any work, check to see if there is a locally built copy of
    // the Python Environment Tool in the `pet / target` directory. If so, we'll assume
    // that the user is a kernel developer and skip the download; this version
    // will take precedence over any downloaded version.
    const extensionParent = path.dirname(__dirname);
    const petFolder = path.join(extensionParent, 'python-env-tools');
    if (fs.existsSync(petFolder)) {
        console.log(`Using locally built PET in ${petFolder}.`);
        return;
    }
    console.log(`No locally built Python Environment Tool found in ${petFolder}; checking downloaded version.`);

    const packageJsonVersion = await getVersionFromPackageJson();
    const localPetVersion = await getLocalPetVersion();

    if (!packageJsonVersion) {
        throw new Error('Could not determine PET version from package.json.');
    }

    console.log(`package.json version: ${packageJsonVersion} `);
    console.log(`Downloaded PET version: ${localPetVersion || 'Not found'} `);

    if (packageJsonVersion === localPetVersion) {
        console.log('Versions match. No action required.');
        return;
    }

    // We can optionally use a Github Personal Access Token (PAT) to download
    // PET. Because this is sensitive information, there are a lot of ways to
    // set it. We try the following in order:

    // (1) The GITHUB_PAT environment variable.
    // (2) The POSITRON_GITHUB_RO_PAT environment variable.
    // (3) The git config setting 'credential.https://api.github.com.token'.

    // (1) Get the GITHUB_PAT from the environment.
    let githubPat = process.env.GITHUB_PAT;
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
            // We don't care if this fails; we'll try without a PAT.
        }
    }

    await downloadAndReplacePet(packageJsonVersion, githubPat);
}

main().catch((error) => {
    console.error('An error occurred:', error);
});
