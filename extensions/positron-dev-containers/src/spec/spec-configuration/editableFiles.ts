/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as jsonc from 'jsonc-parser';
import { URI } from 'vscode-uri';
import { uriToFsPath, FileHost } from './configurationCommonUtils';
import { readLocalFile, writeLocalFile } from '../spec-utils/pfs';

export type Edit = jsonc.Edit;

export interface Documents {
	readDocument(uri: URI): Promise<string | undefined>;
	applyEdits(uri: URI, edits: Edit[], content: string): Promise<void>;
}

export const fileDocuments: Documents = {

	async readDocument(uri: URI) {
		switch (uri.scheme) {
			case 'file':
				try {
					const buffer = await readLocalFile(uri.fsPath);
					return buffer.toString();
				} catch (err) {
					if (err && err.code === 'ENOENT') {
						return undefined;
					}
					throw err;
				}
			default:
				throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
	},

	async applyEdits(uri: URI, edits: Edit[], content: string) {
		switch (uri.scheme) {
			case 'file':
				const result = jsonc.applyEdits(content, edits);
				await writeLocalFile(uri.fsPath, result);
				break;
			default:
				throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
	}
};

export class CLIHostDocuments implements Documents {

	static scheme = 'vscode-fileHost';

	constructor(private fileHost: FileHost) {
	}

	async readDocument(uri: URI) {
		switch (uri.scheme) {
			case CLIHostDocuments.scheme:
				try {
					return (await this.fileHost.readFile(uriToFsPath(uri, this.fileHost.platform))).toString();
				} catch (err) {
					return undefined;
				}
			default:
				throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
	}

	async applyEdits(uri: URI, edits: Edit[], content: string) {
		switch (uri.scheme) {
			case CLIHostDocuments.scheme:
				const result = jsonc.applyEdits(content, edits);
				await this.fileHost.writeFile(uriToFsPath(uri, this.fileHost.platform), Buffer.from(result));
				break;
			default:
				throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
	}
}

export class RemoteDocuments implements Documents {

	static scheme = 'vscode-remote';

	private static nonce: string | undefined;

	constructor(private shellServer: ShellServer) {
	}

	async readDocument(uri: URI) {
		switch (uri.scheme) {
			case RemoteDocuments.scheme:
				try {
					const { stdout } = await this.shellServer.exec(`cat ${uri.path}`);
					return stdout;
				} catch (err) {
					return undefined;
				}
			default:
				throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
	}

	async applyEdits(uri: URI, edits: Edit[], content: string) {
		switch (uri.scheme) {
			case RemoteDocuments.scheme:
				try {
					if (!RemoteDocuments.nonce) {
						RemoteDocuments.nonce = crypto.randomUUID();
					}
					const result = jsonc.applyEdits(content, edits);
					const eof = `EOF-${RemoteDocuments.nonce}`;
					await this.shellServer.exec(`cat <<'${eof}' >${uri.path}
${result}
${eof}
`);
				} catch (err) {
					console.log(err); // XXX
				}
				break;
			default:
				throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
	}
}

export class AllDocuments implements Documents {

	constructor(private documents: Record<string, Documents>) {
	}

	async readDocument(uri: URI) {
		const documents = this.documents[uri.scheme];
		if (!documents) {
			throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
		return documents.readDocument(uri);
	}

	async applyEdits(uri: URI, edits: Edit[], content: string) {
		const documents = this.documents[uri.scheme];
		if (!documents) {
			throw new Error(`Unsupported scheme: ${uri.toString()}`);
		}
		return documents.applyEdits(uri, edits, content);
	}
}

export function createDocuments(fileHost: FileHost, shellServer?: ShellServer): Documents {
	const documents: Record<string, Documents> = {
		file: fileDocuments,
		[CLIHostDocuments.scheme]: new CLIHostDocuments(fileHost),
	};
	if (shellServer) {
		documents[RemoteDocuments.scheme] = new RemoteDocuments(shellServer);
	}
	return new AllDocuments(documents);
}

export interface ShellServer {
	exec(cmd: string, options?: { logOutput?: boolean; stdin?: Buffer }): Promise<{ stdout: string; stderr: string }>;
}
