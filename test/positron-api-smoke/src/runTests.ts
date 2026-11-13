/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { defaultCachePath } from '@vscode/test-electron/out/download';
import { runTests } from '@vscode/test-electron';

// This file is TOOLING: it runs under plain Node, downloads a Positron daily,
// and launches it as an extension-host test runner. It does NOT run inside the
// extension host.
//
// The downloadAndUnzipPositron() logic below is copied (darwin/arm64-only trim)
// from extensions/positron-python/src/test/positron/testElectron.ts. It is
// copied rather than imported on purpose: an external extension author cannot
// import positron-python internals, so this demonstrates exactly what they would
// vendor. It caches to the same .vscode-test dir, reusing an already-downloaded
// build.

const COMPLETE_FILE_NAME = 'is-complete';
const USER_AGENT = 'positron-api-smoke';

const httpsGetAsync = (opts: string | https.RequestOptions) =>
	new Promise<IncomingMessage>((resolve, reject) => {
		const req = https.get(opts, resolve);
		req.once('error', reject);
	});

async function executeCommand(command: string, stdin?: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
		if (stdin) {
			child.stdin!.write(stdin);
			child.stdin!.end();
		}
	});
}

/**
 * Resolve a GitHub PAT the same way positron-python does. It is only used to
 * politely rate-limit the releases API call; the actual bytes come from the
 * public CDN, so a missing PAT is not necessarily fatal for the CDN download.
 */
async function resolveGithubPat(): Promise<string | undefined> {
	let githubPat = process.env.GITHUB_PAT ?? process.env.POSITRON_GITHUB_RO_PAT;
	if (githubPat) {
		return githubPat;
	}
	try {
		const { stdout } = await executeCommand('git config --get credential.https://api.github.com.token');
		githubPat = stdout.trim();
	} catch {
		// ignore; the CDN download does not require a PAT
	}
	return githubPat || undefined;
}

/**
 * Download and unzip the latest Positron daily to the vscode-test cache.
 * Roughly equivalent to `downloadAndUnzipVSCode` from `@vscode/test-electron`.
 */
async function downloadAndUnzipPositron(): Promise<{ version: string; executablePath: string }> {
	const { platform } = process;
	if (platform !== 'darwin') {
		throw new Error(`This spike supports darwin only; got ${platform}.`);
	}

	// Best-effort PAT; logged for parity with positron-python but not required.
	const githubPat = await resolveGithubPat();
	console.log(githubPat ? 'Found a GitHub PAT.' : 'No GitHub PAT found; continuing (CDN download does not require one).');

	// Note: GitHub's macos-latest runners use Apple Silicon (arm64).
	const cdnResponse = await httpsGetAsync({
		headers: { 'User-Agent': USER_AGENT },
		method: 'GET',
		protocol: 'https:',
		hostname: 'cdn.posit.co',
		path: '/positron/dailies/mac/arm64/releases.json',
	});

	let cdnResponseBody = '';
	cdnResponse.on('data', (chunk) => (cdnResponseBody += chunk));
	const cdnRelease = await new Promise<{ version: string }>((resolve, reject) => {
		cdnResponse.once('end', () => {
			if (cdnResponse.statusCode !== 200) {
				reject(new Error(`Failed to download releases from CDN: HTTP ${cdnResponse.statusCode}\n\n${cdnResponseBody}`));
			} else {
				resolve(JSON.parse(cdnResponseBody));
			}
		});
	});

	const version = cdnRelease.version;
	console.log(`Using ${version} build of Positron`);

	const installDir = path.join(defaultCachePath, `positron-${platform}`);
	const completeFile = path.join(installDir, COMPLETE_FILE_NAME);
	const executablePath = path.join(installDir, 'Positron.app', 'Contents', 'MacOS', 'Positron');

	if (fs.existsSync(completeFile)) {
		const existingVersion = (await fsp.readFile(completeFile, 'utf-8')).trim();
		if (existingVersion === version) {
			console.log(`Found existing install in ${installDir}`);
			return { version, executablePath };
		}
	}

	const fileName = `Positron-darwin-${version}-arm64.zip`;
	const url = new URL(`https://cdn.posit.co/positron/dailies/mac/arm64/${fileName}`);
	console.log(`Downloading Positron for ${platform} from ${url.href}`);

	let dlResponse = await httpsGetAsync({
		headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
		method: 'GET',
		protocol: url.protocol,
		hostname: url.hostname,
		path: url.pathname,
	});
	while (dlResponse.statusCode === 302 && dlResponse.headers.location) {
		dlResponse = await httpsGetAsync(dlResponse.headers.location);
	}

	const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-'));
	const downloadPath = path.join(tempDir, fileName);
	try {
		const writer = fs.createWriteStream(downloadPath);
		dlResponse.pipe(writer);
		await new Promise<void>((resolve, reject) => {
			writer.once('finish', () => resolve());
			writer.once('error', reject);
		});

		await fsp.mkdir(installDir, { recursive: true });

		const fileStats = await fsp.stat(downloadPath);
		console.log(`Downloaded ZIP file size: ${fileStats.size} bytes`);
		if (fileStats.size < 1_000_000) {
			throw new Error(`Downloaded ZIP appears corrupted or incomplete. Expected at least 1MB, got ${fileStats.size} bytes.`);
		}

		const targetPath = path.join(installDir, 'Positron.app');
		await fsp.rm(targetPath, { recursive: true, force: true });

		console.log(`Installing Positron to ${installDir}`);
		spawnSyncCommand('unzip', ['-q', downloadPath, '-d', installDir]);
		await fsp.writeFile(completeFile, version.trim(), 'utf-8');

		return { version, executablePath };
	} finally {
		await fsp.rm(downloadPath, { force: true });
	}
}

function spawnSyncCommand(command: string, args: string[]): void {
	const result = spawnSync(command, args);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(' ')}\nExit ${result.status}\n${result.stderr?.toString()}`);
	}
}

/**
 * Defensive Gatekeeper safety net. In practice the quarantine attribute is NOT
 * applied here: the build is fetched programmatically via https.get (not a
 * browser) and extracted with CLI `unzip`, and only browser/LaunchServices
 * downloads get flagged. This runs anyway so the harness stays robust if a build
 * is ever obtained a different way. `xattr -dr` exits 0 whether or not the
 * attribute was present, so this is a best-effort no-op in the common case.
 */
function removeQuarantine(appPath: string): void {
	spawnSync('xattr', ['-dr', 'com.apple.quarantine', appPath]);
}

async function main(): Promise<void> {
	const { version, executablePath } = await downloadAndUnzipPositron();

	// Gatekeeper: the CDN-downloaded .app carries a quarantine flag; strip it so
	// the headless launch is not blocked by a "cannot be opened" dialog.
	const appPath = path.join(defaultCachePath, `positron-${process.platform}`, 'Positron.app');
	removeQuarantine(appPath);

	// A clean, temporary user-data-dir keeps state isolated across runs and
	// suppresses first-run prompts (workspace trust, release notes).
	const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-uddir-'));

	const extensionDevelopmentPath = path.resolve(__dirname, '..');
	const extensionTestsPath = path.resolve(__dirname, './test/index.js');

	const exitCode = await runTests({
		version,
		vscodeExecutablePath: executablePath,
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs: ['--user-data-dir', userDataDir, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
	});

	process.exit(exitCode);
}

main().catch((err) => {
	console.error('Failed to run Positron API smoke test:', err);
	process.exit(1);
});
