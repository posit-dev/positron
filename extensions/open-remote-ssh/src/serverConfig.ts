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
	const customDataFolderName = vscode.workspace.getConfiguration('remoteSSH').get<string>('serverInstallPath', '');

	const version = `${positron.version}-${positron.buildNumber}`;

	return {
		version,
		commit: productJson.commit,
		quality: productJson.quality,
		release: productJson.release,
		serverApplicationName: customServerBinaryName || productJson.serverApplicationName,
		serverDataFolderName: customDataFolderName || productJson.serverDataFolderName,
		serverDownloadUrlTemplate: productJson.serverDownloadUrlTemplate
	};
}
