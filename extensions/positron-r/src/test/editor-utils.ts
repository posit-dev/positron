// From testUtils.ts in the typescript-language-feature extension
// https://github.com/posit-dev/positron/blob/main/extensions/typescript-language-features/src/test/testUtils.ts

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
}

export const CURSOR = '"<>"';

export async function withFileEditor(
	contents: string,
	fileExtension: string,
	run: (editor: vscode.TextEditor, doc: vscode.TextDocument) => Promise<void>
): Promise<void> {
	const cursorIndex = contents.indexOf(CURSOR);
	const rawContents = contents.replace(CURSOR, '');

	const file = await createRandomFile(rawContents, fileExtension);

	try {
		const doc = await vscode.workspace.openTextDocument(file);
		const editor = await vscode.window.showTextDocument(doc);

		editor.options.insertSpaces = true;
		editor.options.indentSize = 4;
		editor.options.tabSize = 4;

		if (cursorIndex >= 0) {
			const pos = doc.positionAt(cursorIndex);
			editor.selection = new vscode.Selection(pos, pos);
		}

		await run(editor, doc);

		if (doc.isDirty) {
			await doc.save();
		}
	} finally {
		deleteFile(file);
	}
}

export const onDocumentChange = (doc: vscode.TextDocument): Promise<vscode.TextDocument> => {
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
