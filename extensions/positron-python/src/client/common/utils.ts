'use strict';
// tslint:disable: no-any one-line no-suspicious-comment prefer-template prefer-const no-unnecessary-callback-wrapper no-function-expression no-string-literal no-control-regex no-shadowed-variable
// TODO: Cleanup this place
// Add options for execPythonFile

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Position, Range, TextDocument, Uri } from 'vscode';
import * as settings from './configSettings';
import { parseEnvFile } from './envFileParser';

export const IS_WINDOWS = /^win/.test(process.platform);
export const Is_64Bit = os.arch() === 'x64';
export const PATH_VARIABLE_NAME = IS_WINDOWS ? 'Path' : 'PATH';

const PathValidity: Map<string, boolean> = new Map<string, boolean>();
export function validatePath(filePath: string): Promise<string> {
    if (filePath.length === 0) {
        return Promise.resolve('');
    }
    if (PathValidity.has(filePath)) {
        return Promise.resolve(PathValidity.get(filePath) ? filePath : '');
    }
    return new Promise<string>(resolve => {
        fs.exists(filePath, exists => {
            PathValidity.set(filePath, exists);
            return resolve(exists ? filePath : '');
        });
    });
}
export function fsExistsAsync(filePath: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        fs.exists(filePath, exists => {
            PathValidity.set(filePath, exists);
            return resolve(exists);
        });
    });
}
export function fsReaddirAsync(root: string): Promise<string[]> {
    return new Promise<string[]>(resolve => {
        // Now look for Interpreters in this directory
        fs.readdir(root, (err, subDirs) => {
            if (err) {
                return resolve([]);
            }
            resolve(subDirs.map(subDir => path.join(root, subDir)));
        });
    });
}

export async function getPathFromPythonCommand(pythonPath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        child_process.execFile(pythonPath, ['-c', 'import sys;print(sys.executable)'], (_, stdout) => {
            if (stdout) {
                const lines = stdout.split(/\r?\n/g).map(line => line.trim()).filter(line => line.length > 0);
                resolve(lines.length > 0 ? lines[0] : '');
            } else {
                reject();
            }
        });
    });
}
export function formatErrorForLogging(error: Error | string): string {
    let message: string = '';
    if (typeof error === 'string') {
        message = error;
    }
    else {
        if (error.message) {
            message = `Error Message: ${error.message}`;
        }
        if (error.name && error.message.indexOf(error.name) === -1) {
            message += `, (${error.name})`;
        }
        const innerException = (error as any).innerException;
        if (innerException && (innerException.message || innerException.name)) {
            if (innerException.message) {
                message += `, Inner Error Message: ${innerException.message}`;
            }
            if (innerException.name && innerException.message.indexOf(innerException.name) === -1) {
                message += `, (${innerException.name})`;
            }
        }
    }
    return message;
}

export function getSubDirectories(rootDir: string): Promise<string[]> {
    return new Promise<string[]>(resolve => {
        fs.readdir(rootDir, (error, files) => {
            if (error) {
                return resolve([]);
            }
            const subDirs: string[] = [];
            files.forEach(name => {
                const fullPath = path.join(rootDir, name);
                try {
                    if (fs.statSync(fullPath).isDirectory()) {
                        subDirs.push(fullPath);
                    }
                }
                // tslint:disable-next-line:no-empty
                catch (ex) { }
            });
            resolve(subDirs);
        });
    });
}

export async function getCustomEnvVars(resource?: Uri): Promise<{} | undefined | null> {
    const envFile = settings.PythonSettings.getInstance(resource).envFile;
    if (typeof envFile !== 'string' || envFile.length === 0) {
        return null;
    }
    const exists = await fsExtra.pathExists(envFile);
    if (!exists) {
        return null;
    }
    try {
        const vars = parseEnvFile(envFile);
        if (vars && typeof vars === 'object' && Object.keys(vars).length > 0) {
            return vars;
        }
    } catch (ex) {
        console.error('Failed to parse env file', ex);
    }
    return null;
}
export function getCustomEnvVarsSync(resource?: Uri): {} | undefined | null {
    const envFile = settings.PythonSettings.getInstance(resource).envFile;
    if (typeof envFile !== 'string' || envFile.length === 0) {
        return null;
    }
    const exists = fsExtra.pathExistsSync(envFile);
    if (!exists) {
        return null;
    }
    try {
        const vars = parseEnvFile(envFile);
        if (vars && typeof vars === 'object' && Object.keys(vars).length > 0) {
            return vars;
        }
    } catch (ex) {
        console.error('Failed to parse env file', ex);
    }
    return null;
}

export function getWindowsLineEndingCount(document: TextDocument, offset: Number) {
    const eolPattern = new RegExp('\r\n', 'g');
    const readBlock = 1024;
    let count = 0;
    let offsetDiff = offset.valueOf();

    // In order to prevent the one-time loading of large files from taking up too much memory
    for (let pos = 0; pos < offset; pos += readBlock) {
        let startAt = document.positionAt(pos);
        let endAt: Position;

        if (offsetDiff >= readBlock) {
            endAt = document.positionAt(pos + readBlock);
            offsetDiff = offsetDiff - readBlock;
        } else {
            endAt = document.positionAt(pos + offsetDiff);
        }

        let text = document.getText(new Range(startAt, endAt!));
        let cr = text.match(eolPattern);

        count += cr ? cr.length : 0;
    }
    return count;
}

export function arePathsSame(path1: string, path2: string) {
    path1 = path.normalize(path1);
    path2 = path.normalize(path2);
    if (IS_WINDOWS) {
        return path1.toUpperCase() === path2.toUpperCase();
    } else {
        return path1 === path2;
    }
}
