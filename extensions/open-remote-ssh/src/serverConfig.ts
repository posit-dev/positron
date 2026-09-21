/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The code in extensions/open-remote-ssh has been adapted from https://github.com/jeanp413/open-remote-ssh,
// which is licensed under the MIT license.

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The dailies release manifest. Its `version` field names the most recent daily
 * build, which is the newest server the CDN actually has a tarball for.
 */
const DAILY_RELEASES_URL = 'https://cdn.posit.co/positron/dailies/deb/x86_64/releases.json';

/** The quality the dailies are published under, which forms part of their CDN path. */
const DAILY_QUALITY = 'dailies';

/**
 * Whether this is a built instance rather than a dev one, matching
 * `IEnvironmentService.isBuilt`. That service isn't reachable from the
 * extension host and the `vscode` API doesn't expose `isBuilt`, so read the
 * same environment variable it does.
 */
function isBuilt(): boolean {
	return !process.env['VSCODE_DEV'];
}

/**
 * The latest daily build a dev instance borrows to download a server.
 */
interface IDailyRelease {
	/** The daily's Positron version, e.g. '2026.10.0-70'. */
	version: string;
	/** The commit the daily was built from, which keys the server install directory. */
	commit: string;
}

/**
 * Reads the latest daily build from the release manifest. Returns undefined if
 * the manifest can't be read or doesn't name both a version and a commit, since
 * borrowing one without the other would install a server under a key that
 * doesn't identify it.
 *
 * The timeout is a deadline for the whole request, not an inactivity timeout,
 * so a response that is aborted after its headers or trickles in indefinitely
 * still settles: `getVSCodeServerConfig` is awaited on the connection path, and
 * a hang there stops the connection with no error and no log line.
 */
async function getDailyRelease(): Promise<IDailyRelease | undefined> {
	try {
		const response = await fetch(DAILY_RELEASES_URL, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) {
			return undefined;
		}
		const { version, commit } = await response.json() as { version?: unknown; commit?: unknown };
		if (typeof version !== 'string' || typeof commit !== 'string') {
			return undefined;
		}
		return { version, commit };
	} catch {
		return undefined;
	}
}

let vscodeProductJson: any;
async function getVSCodeProductJson() {
	if (!vscodeProductJson) {
		const productJsonStr = await fs.promises.readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8');
		vscodeProductJson = JSON.parse(productJsonStr);
	}

	return vscodeProductJson;
}

export interface IServerConfig {
	version: string;
	commit: string;
	quality: string;
	release?: string; // vscodium-like specific
	serverApplicationName: string;
	serverDataFolderName: string;
	serverDownloadUrlTemplate?: string; // vscodium-like specific
}

export async function getVSCodeServerConfig(): Promise<IServerConfig> {
	const productJson = await getVSCodeProductJson();

	const customServerBinaryName = vscode.workspace.getConfiguration('remoteSSH.experimental').get<string>('serverBinaryName', '');

	// A dev instance has no server of its own on the CDN: its build number is 0,
	// so the version it derives was never published, and it has no quality to
	// name a directory to look in. Borrow the latest daily build instead, so a
	// dev instance can still connect to a remote host. If the daily release
	// can't be read, fall through to the local values and let the install script
	// report that no server is available.
	//
	// The daily's commit is borrowed along with its version: the commit keys the
	// server install directory on the remote, and a source build has none, so
	// every daily would otherwise install over the same `bin/undefined` and a
	// newer daily would reuse a stale server.
	let version = `${positron.version}-${positron.buildNumber}`;
	let commit = productJson.commit;
	let quality = productJson.quality;
	if (!isBuilt()) {
		const daily = await getDailyRelease();
		if (daily) {
			version = daily.version;
			commit = daily.commit;
			quality = DAILY_QUALITY;
		}
	}

	return {
		version,
		commit,
		quality,
		release: productJson.release,
		serverApplicationName: customServerBinaryName || productJson.serverApplicationName,
		serverDataFolderName: productJson.serverDataFolderName,
		serverDownloadUrlTemplate: productJson.serverDownloadUrlTemplate
	};
}
