/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { untildify } from '../../common/helpers';
import { dispose } from '../../common/utils/resourceLifecycle';
import { traceWarn } from '../../logging';

/**
 * Manages temporary files backing the "run file" gesture for unsaved (untitled)
 * scripts. The untitled buffer is written to a scratch file on disk so that
 * IPython's `%run` can read it, then the file is cleaned up.
 *
 * Files are deleted when their run finishes (the primary path), when the
 * originating editor is closed, and when the extension is disposed. In-flight
 * runs are ref-counted per file so a rapid re-run does not delete a file that a
 * queued run has not yet read.
 */
export class UnsavedScriptFiles implements vscode.Disposable {
    /** Untitled document URI -> temp file path. */
    private readonly _files = new Map<string, string>();

    /** Temp file path -> number of runs currently in flight. */
    private readonly _inFlight = new Map<string, number>();

    private readonly _disposables: vscode.Disposable[] = [];

    constructor() {
        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                if (document.isUntitled) {
                    this.onDocumentClosed(document.uri);
                }
            }),
        );
    }

    /**
     * Writes the untitled document's contents to a scratch file and registers a
     * run as in flight. Returns the file path to run.
     */
    public async write(document: vscode.TextDocument): Promise<string> {
        const directory = await resolveScratchDirectory();
        const filePath = path.join(directory, scratchFileName(document));
        await fs.promises.writeFile(filePath, document.getText(), 'utf8');
        this._files.set(document.uri.toString(), filePath);
        this._inFlight.set(filePath, (this._inFlight.get(filePath) ?? 0) + 1);
        return filePath;
    }

    /**
     * Marks a run of the given scratch file as finished, deleting the file once
     * no runs remain in flight.
     */
    public async finished(filePath: string): Promise<void> {
        const remaining = (this._inFlight.get(filePath) ?? 1) - 1;
        if (remaining > 0) {
            this._inFlight.set(filePath, remaining);
            return;
        }
        this._inFlight.delete(filePath);
        this.forgetFile(filePath);
        await deleteQuietly(filePath);
    }

    /** Drops any untitled-URI mappings that point at the given scratch file. */
    private forgetFile(filePath: string): void {
        for (const [uri, mapped] of this._files) {
            if (mapped === filePath) {
                this._files.delete(uri);
            }
        }
    }

    private onDocumentClosed(uri: vscode.Uri): void {
        const filePath = this._files.get(uri.toString());
        if (!filePath) {
            return;
        }
        this._files.delete(uri.toString());
        // If a run is still in flight, let finished() delete the file.
        if (!this._inFlight.has(filePath)) {
            void deleteQuietly(filePath);
        }
    }

    public dispose(): void {
        dispose(this._disposables);
        for (const filePath of this._files.values()) {
            void deleteQuietly(filePath);
        }
        this._files.clear();
        this._inFlight.clear();
    }
}

/**
 * Resolves the directory scratch files are written to: the configured directory
 * if set and writable, else the workspace root, else the system temporary
 * directory.
 */
async function resolveScratchDirectory(): Promise<string> {
    const configured = vscode.workspace.getConfiguration('interpreters').get<string>('unsavedScriptsDirectory')?.trim();
    if (configured) {
        // Resolve relative paths against the workspace root (or home when no
        // workspace is open) so they don't depend on the extension host's
        // working directory.
        const expanded = untildify(configured);
        const directory = path.isAbsolute(expanded)
            ? path.normalize(expanded)
            : path.resolve(workspaceRoot() ?? os.homedir(), expanded);
        try {
            await fs.promises.mkdir(directory, { recursive: true });
            // mkdir succeeds silently on an existing directory without checking
            // writability, so probe it explicitly before committing.
            await fs.promises.access(directory, fs.constants.W_OK);
            return canonicalize(directory);
        } catch (error) {
            traceWarn(
                `Cannot use configured unsaved scripts directory '${directory}': ${error}. Falling back to the system temporary directory.`,
            );
            return canonicalize(os.tmpdir());
        }
    }
    return canonicalize(workspaceRoot() ?? os.tmpdir());
}

/** The first file-scheme workspace folder path, if any. */
function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')?.uri.fsPath;
}

/**
 * Puts a directory into the same form the session reports as its working
 * directory, so scratch file paths can be made relative to it.
 *
 * On POSIX, `getcwd()` resolves symlinks (e.g. macOS /var -> /private/var), so
 * we resolve them too. On Windows, `GetCurrentDirectory` echoes the launch path
 * verbatim; realpath would instead expand 8.3 short names (RUNNER~1 ->
 * runneradmin) and make the paths diverge, so leave the path as-is.
 */
async function canonicalize(directory: string): Promise<string> {
    if (process.platform === 'win32') {
        return directory;
    }
    try {
        return await fs.promises.realpath(directory);
    } catch {
        return directory;
    }
}

/** Builds a stable, hidden scratch file name from an untitled document. */
function scratchFileName(document: vscode.TextDocument): string {
    const base = path.basename(document.uri.path).replace(/[^\w.-]/g, '_');
    return `.positron-${base.toLowerCase()}.py`;
}

async function deleteQuietly(filePath: string): Promise<void> {
    try {
        await fs.promises.rm(filePath, { force: true });
    } catch (error) {
        traceWarn(`Cannot delete unsaved script scratch file '${filePath}': ${error}`);
    }
}
