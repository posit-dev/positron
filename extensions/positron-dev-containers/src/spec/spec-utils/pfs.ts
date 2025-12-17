/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import * as ncp from 'ncp';

import { URI } from 'vscode-uri';

export function isLocalFile(filepath: string): Promise<boolean> {
	return new Promise(r => fs.stat(filepath, (err, stat) => r(!err && stat.isFile())));
}

export function isLocalFolder(filepath: string): Promise<boolean> {
	return new Promise(r => fs.stat(filepath, (err, stat) => r(!err && stat.isDirectory())));
}

export const readLocalFile = promisify(fs.readFile);
export const writeLocalFile = promisify(fs.writeFile);
export const appendLocalFile = promisify(fs.appendFile);
export const renameLocal = promisify(fs.rename);
export const readLocalDir = promisify(fs.readdir);
export const unlinkLocal = promisify(fs.unlink);
export const mkdirpLocal = (path: string) => new Promise<void>((res, rej) => fs.mkdir(path, { recursive: true }, err => err ? rej(err) : res()));
export const rmdirLocal = promisify(fs.rmdir);
export const rmLocal = promisify(fs.rm);
export const cpLocal = promisify(fs.copyFile);
export const cpDirectoryLocal = promisify(ncp.ncp);

export interface FileHost {
	platform: NodeJS.Platform;
	path: typeof path.posix | typeof path.win32;
	isFile(filepath: string): Promise<boolean>;
	readFile(filepath: string): Promise<Buffer>;
	writeFile(filepath: string, content: Buffer): Promise<void>;
	readDir(dirpath: string): Promise<string[]>;
	readDirWithTypes?(dirpath: string): Promise<[string, FileTypeBitmask][]>;
	mkdirp(dirpath: string): Promise<void>;
	toCommonURI(filePath: string): Promise<URI | undefined>;
}

export enum FileTypeBitmask {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}
