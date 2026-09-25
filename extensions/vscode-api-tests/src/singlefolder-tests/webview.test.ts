/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { asPromise, closeAllEditors, createRandomFile } from '../utils';

suite('vscode API - webview', () => {
	const disposables: vscode.Disposable[] = [];
	const webviewViewType = 'webview-resource-load-test';
	const resourceCount = 625;
	const resourceSize = 128 * 1024;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('vscode.vscode-api-tests')?.activate();
	});

	teardown(() => {
		vscode.Disposable.from(...disposables).dispose();
		disposables.length = 0;
	});

	test('loads many local resources concurrently without crashing', async function () {
		if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
			this.skip();
		}

		const timeout = 60_000;
		this.timeout(timeout);

		const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vscode-webview-resource-load-'));
		try {
			const panel = vscode.window.createWebviewPanel(webviewViewType, 'Webview Resource Load Test', vscode.ViewColumn.Active, {
				enableScripts: true,
				localResourceRoots: [vscode.Uri.file(tempDir)],
			});
			disposables.push(panel);

			const didDispose = asPromise(panel.onDidDispose, timeout);
			const didReceiveMessage = new Promise<{
				readonly type: 'done';
				readonly count: number;
				readonly totalBytes: number;
			}>((resolve, reject) => {
				disposables.push(panel.webview.onDidReceiveMessage(message => {
					if (message?.type === 'done') {
						resolve(message);
					} else if (message?.type === 'error') {
						reject(new Error(message.message));
					}
				}));
			});

			const expectedTotalBytes = resourceCount * resourceSize;
			const resources: string[] = [];
			for (let index = 0; index < resourceCount; index++) {
				const filePath = path.join(tempDir, `resource-${index}.bin`);
				await writeFile(filePath, Buffer.alloc(resourceSize, index));
				resources.push(panel.webview.asWebviewUri(vscode.Uri.file(filePath)).toString());
			}

			const nonce = String(Date.now());
			panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
</head>
<body>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const resources = ${JSON.stringify(resources)};
		const loadResources = async () => {
			try {
				const lengths = await Promise.all(resources.map(async resource => {
					const response = await fetch(resource);
					if (!response.ok) {
						throw new Error(\`Unexpected status \${response.status} for \${resource}\`);
					}
					const bytes = await response.arrayBuffer();
					return bytes.byteLength;
				}));
				vscode.postMessage({
					type: 'done',
					count: lengths.length,
					totalBytes: lengths.reduce((total, value) => total + value, 0),
				});
			} catch (error) {
				vscode.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : String(error),
				});
			}
		};
		window.addEventListener('error', event => {
			vscode.postMessage({ type: 'error', message: event.message });
		});
		window.addEventListener('unhandledrejection', event => {
			const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
			vscode.postMessage({ type: 'error', message: reason });
		});
		void loadResources();
	</script>
</body>
</html>`;

			const result = await Promise.race([
				didReceiveMessage,
				didDispose.then(() => Promise.reject(new Error('Webview disposed before resources finished loading'))),
			]);

			assert.deepStrictEqual(result, {
				type: 'done',
				count: resourceCount,
				totalBytes: expectedTotalBytes,
			});
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	// --- Start Positron ---
	// Testing ViewColumn.Modal ahead of microsoft/vscode#307838 landing upstream; see positron#16082.
	test('createWebviewPanel ViewColumn.Modal opens in a separate group, not the active one', async () => {
		const doc = await vscode.workspace.openTextDocument(await createRandomFile());
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

		const groupCountBefore = vscode.window.tabGroups.all.length;

		const title = 'Modal Webview Test';
		const panel = vscode.window.createWebviewPanel('webview-modal-test', title, vscode.ViewColumn.Modal, {});
		disposables.push(panel);

		try {
			await asPromise(vscode.window.tabGroups.onDidChangeTabs, 2000);

			const groups = vscode.window.tabGroups.all;
			assert.strictEqual(groups.length, groupCountBefore + 1,
				'opening a webview in ViewColumn.Modal should add a separate group rather than reuse the active one');

			const modalGroup = groups.find(g => g.tabs.some(t => t.label === title));
			assert.ok(modalGroup, 'the webview should appear in some tab group');
			assert.strictEqual(modalGroup!.tabs.length, 1, 'the modal group should contain only the webview tab');

			const originalGroup = groups.find(g => g !== modalGroup);
			assert.strictEqual(originalGroup!.tabs.length, 1,
				'the original active group should be untouched by opening a webview in ViewColumn.Modal');
		} finally {
			await closeAllEditors();
		}
	});
	// --- End Positron ---
});
