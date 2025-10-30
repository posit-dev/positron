/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The code in extensions/open-remote-ssh has been adapted from https://github.com/jeanp413/open-remote-ssh,
// which is licensed under the MIT license.

import * as vscode from 'vscode';
import * as fs from 'fs';
import { getRemoteAuthority } from './authResolver';
import SSHConfiguration, { getSSHConfigPath } from './ssh/sshConfig';
import { exists as fileExists } from './common/files';
import SSHDestination from './ssh/sshDestination';

interface HostQuickPickItem extends vscode.QuickPickItem {
	hostname?: string;
	isAddOption?: boolean;
}

export async function promptOpenRemoteSSHWindow(reuseWindow: boolean) {
	const sshConfigFile = await SSHConfiguration.loadFromFS();
	const configuredHosts = sshConfigFile.getAllConfiguredHosts();

	const baseItems: HostQuickPickItem[] = configuredHosts.map(hostname => ({
		label: hostname,
		hostname: hostname,
	}));
	baseItems.push({
		label: vscode.l10n.t('$(add) Add host to SSH config file...'),
		isAddOption: true,
	});

	const quickPick = vscode.window.createQuickPick<HostQuickPickItem>();
	quickPick.title = vscode.l10n.t('Select a host, or type [user@]hostname[:port]');
	quickPick.ignoreFocusOut = true;
	quickPick.items = baseItems;

	quickPick.onDidChangeValue((value) => {
		if (!value.trim()) {
			quickPick.items = baseItems;
			return;
		}

		const matchesExisting = configuredHosts.some(host => host.toLowerCase() === value.toLowerCase());
		if (!matchesExisting && value.trim()) {
			// Add the custom hostname as the first item
			quickPick.items = [
				{
					label: value,
					description: vscode.l10n.t('Connect to this host'),
					hostname: value,
				},
				...baseItems
			];
		} else {
			quickPick.items = baseItems;
		}
	});

	const selected = await new Promise<HostQuickPickItem | undefined>(resolve => {
		quickPick.onDidAccept(() => {
			resolve(quickPick.selectedItems[0]);
			quickPick.dispose();
		});
		quickPick.onDidHide(() => {
			resolve(undefined);
			quickPick.dispose();
		});
		quickPick.show();
	});
	if (!selected) {
		return;
	}

	let host: string | undefined;
	if (selected.isAddOption) {
		await addNewHost();
	} else {
		host = selected.hostname;
	}
	if (!host) {
		return;
	}

	const sshDest = new SSHDestination(host);
	openRemoteSSHWindow(sshDest.toEncodedString(), reuseWindow);
}

export function openRemoteSSHWindow(host: string, reuseWindow: boolean) {
	vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: getRemoteAuthority(host), reuseWindow });
}

export function openRemoteSSHLocationWindow(host: string, path: string, reuseWindow: boolean) {
	vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({ scheme: 'vscode-remote', authority: getRemoteAuthority(host), path }), { forceNewWindow: !reuseWindow });
}

export async function addNewHost() {
	const sshConfigPath = getSSHConfigPath();
	if (!await fileExists(sshConfigPath)) {
		await fs.promises.appendFile(sshConfigPath, '');
	}

	await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(sshConfigPath), { preview: false });

	const textEditor = vscode.window.activeTextEditor;
	if (textEditor?.document.uri.fsPath !== sshConfigPath) {
		return;
	}

	const textDocument = textEditor.document;
	const lastLine = textDocument.lineAt(textDocument.lineCount - 1);

	if (!lastLine.isEmptyOrWhitespace) {
		await textEditor.edit((editBuilder: vscode.TextEditorEdit) => {
			editBuilder.insert(lastLine.range.end, '\n');
		});
	}

	const snippet = '\nHost ${1:dev}\n\tHostName ${2:dev.example.com}\n\tUser ${3:username}\n';
	await textEditor.insertSnippet(
		new vscode.SnippetString(snippet),
		new vscode.Position(textDocument.lineCount - 1, 0)
	);
}

export async function openSSHConfigFile() {
	const sshConfigPath = getSSHConfigPath();
	if (!await fileExists(sshConfigPath)) {
		await fs.promises.appendFile(sshConfigPath, '');
	}
	vscode.commands.executeCommand('vscode.open', vscode.Uri.file(sshConfigPath));
}
