// From testUtils.ts in the typescript-language-feature extension
// https://github.com/posit-dev/positron/blob/main/extensions/typescript-language-features/src/test/testUtils.ts

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import * as vscode from 'vscode';

export function rndName() {
	let name = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 10; i++) {
		name += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return name;
}

export function createRandomFile(contents = '', fileExtension = 'txt'): Thenable<vscode.Uri> {
	return new Promise((resolve, reject) => {
		const tmpFile = join(os.tmpdir(), rndName() + '.' + fileExtension);
		fs.writeFile(tmpFile, contents, (error) => {
			if (error) {
				return reject(error);
			}

			resolve(vscode.Uri.file(tmpFile));
		});
	});
}

export function deleteFile(file: vscode.Uri): Thenable<boolean> {
	return new Promise((resolve, reject) => {
		fs.unlink(file.fsPath, (err) => {
			if (err) {
				reject(err);
			} else {
				resolve(true);
			}
		});
	});
} export const CURSOR = '$$CURSOR$$';

export function withRandomFileEditor(
	contents: string,
	fileExtension: string,
	run: (editor: vscode.TextEditor, doc: vscode.TextDocument) => Thenable<void>
): Thenable<boolean> {
	const cursorIndex = contents.indexOf(CURSOR);
	return createRandomFile(contents.replace(CURSOR, ''), fileExtension).then(file => {
		return vscode.workspace.openTextDocument(file).then(doc => {
			return vscode.window.showTextDocument(doc).then((editor) => {
				if (cursorIndex >= 0) {
					const pos = doc.positionAt(cursorIndex);
					editor.selection = new vscode.Selection(pos, pos);
				}
				return run(editor, doc).then(_ => {
					if (doc.isDirty) {
						return doc.save().then(() => {
							return deleteFile(file);
						});
					} else {
						return deleteFile(file);
					}
				});
			});
		});
	});
}

const onDocumentChange = (doc: vscode.TextDocument): Promise<vscode.TextDocument> => {
	return new Promise<vscode.TextDocument>(resolve => {
		const sub = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document !== doc) {
				return;
			}
			sub.dispose();
			resolve(e.document);
		});
	});
};

export const type = async (document: vscode.TextDocument, text: string): Promise<vscode.TextDocument> => {
	const onChange = onDocumentChange(document);
	await vscode.commands.executeCommand('type', { text });
	await onChange;
	return document;
};
