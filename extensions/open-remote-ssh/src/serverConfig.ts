/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The code in extensions/open-remote-ssh has been adapted from https://github.com/jeanp413/open-remote-ssh,
// which is licensed under the MIT license.

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as https from 'https';
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
 * The version of the latest daily build, which a dev instance borrows to
 * download a server. Returns undefined if the manifest can't be read.
 */
async function getDailyVersion(): Promise<string | undefined> {
	return new Promise<string | undefined>(resolve => {
		const request = https.get(DAILY_RELEASES_URL, response => {
			if (response.statusCode !== 200) {
				response.resume();
				resolve(undefined);
				return;
			}
			let body = '';
			response.setEncoding('utf8');
			response.on('data', chunk => body += chunk);
			response.on('end', () => {
				try {
					const version = JSON.parse(body).version;
					resolve(typeof version === 'string' ? version : undefined);
				} catch {
					resolve(undefined);
				}
			});
		});
		request.on('error', () => resolve(undefined));
		request.setTimeout(5000, () => {
			request.destroy();
			resolve(undefined);
		});
	});
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
	// dev instance can still connect to a remote host. If the daily version
	// can't be read, fall through to the local values and let the install script
	// report that no server is available.
	let version = `${positron.version}-${positron.buildNumber}`;
	let quality = productJson.quality;
	if (!isBuilt()) {
		const dailyVersion = await getDailyVersion();
		if (dailyVersion) {
			version = dailyVersion;
			quality = DAILY_QUALITY;
		}
	}

	return {
		version,
		commit: productJson.commit,
		quality,
		release: productJson.release,
		serverApplicationName: customServerBinaryName || productJson.serverApplicationName,
		serverDataFolderName: productJson.serverDataFolderName,
		serverDownloadUrlTemplate: productJson.serverDownloadUrlTemplate
	};
}
