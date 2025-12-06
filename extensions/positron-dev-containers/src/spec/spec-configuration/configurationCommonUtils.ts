/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import { URI } from 'vscode-uri';

import { CLIHostDocuments } from './editableFiles';
import { FileHost } from '../spec-utils/pfs';

export { FileHost } from '../spec-utils/pfs';

const enum CharCode {
	Slash = 47,
	Colon = 58,
	A = 65,
	Z = 90,
	a = 97,
	z = 122,
}

export function uriToFsPath(uri: URI, platform: NodeJS.Platform): string {

	let value: string;
	if (uri.authority && uri.path.length > 1 && (uri.scheme === 'file' || uri.scheme === CLIHostDocuments.scheme)) {
		// unc path: file://shares/c$/far/boo
		value = `//${uri.authority}${uri.path}`;
	} else if (
		uri.path.charCodeAt(0) === CharCode.Slash
		&& (uri.path.charCodeAt(1) >= CharCode.A && uri.path.charCodeAt(1) <= CharCode.Z || uri.path.charCodeAt(1) >= CharCode.a && uri.path.charCodeAt(1) <= CharCode.z)
		&& uri.path.charCodeAt(2) === CharCode.Colon
	) {
		// windows drive letter: file:///c:/far/boo
		value = uri.path[1].toLowerCase() + uri.path.substr(2);
	} else {
		// other path
		value = uri.path;
	}
	if (platform === 'win32') {
		value = value.replace(/\//g, '\\');
	}
	return value;
}

export function getWellKnownDevContainerPaths(path_: typeof path.posix | typeof path.win32, folderPath: string): string[] {
	return [
		path_.join(folderPath, '.devcontainer', 'devcontainer.json'),
		path_.join(folderPath, '.devcontainer.json'),
	];
}

export function getDefaultDevContainerConfigPath(fileHost: FileHost, configFolderPath: string) {
	return URI.file(fileHost.path.join(configFolderPath, '.devcontainer', 'devcontainer.json'))
		.with({ scheme: CLIHostDocuments.scheme });
}

export async function getDevContainerConfigPathIn(fileHost: FileHost, configFolderPath: string) {
	const possiblePaths = getWellKnownDevContainerPaths(fileHost.path, configFolderPath);

	for (let possiblePath of possiblePaths) {
		if (await fileHost.isFile(possiblePath)) {
			return URI.file(possiblePath)
				.with({ scheme: CLIHostDocuments.scheme });
		}
	}

	return undefined;
}

export function parentURI(uri: URI) {
	const parent = path.posix.dirname(uri.path);
	return uri.with({ path: parent });
}
