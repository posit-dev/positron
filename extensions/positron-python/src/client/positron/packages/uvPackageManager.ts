/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IProcessServiceFactory } from '../../common/process/types';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IServiceContainer } from '../../ioc/types';
import { isUvInstalled } from '../../pythonEnvironments/common/environmentManagers/uv';
import { traceVerbose } from '../../logging';
import { fetchMetadataWithOutdated } from './packageMetadata';
import { buildRequirementsFile } from './requirementsFile';
import { findWorkspaceRequirementsFile } from './workspaceRequirements';
import {
    addInstalledToRequirements,
    isAutoUpdateRequirementsEnabled,
    removeUninstalledFromRequirements,
} from './requirementsSync';
import { searchPyPI, searchPyPIVersions } from './pypiSearch';
import { IPackageManager, MessageEmitter, PackageSession } from './types';

/**
 * uv Package Manager
 *
 * Provides package management functionality for Python sessions using uv.
 * Supports two workflows:
 * - Project workflow: Uses `uv add`/`uv remove` when a valid pyproject.toml exists
 * - Environment workflow: Uses `uv pip install`/`uv pip uninstall` otherwise
 */
export class UvPackageManager implements IPackageManager {
    constructor(
        private readonly _pythonPath: string,
        private readonly _messageEmitter: MessageEmitter,
        private readonly _serviceContainer: IServiceContainer,
        private readonly _session: PackageSession,
    ) {}

    async getPackages(token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
        return this._callMethod<positron.LanguageRuntimePackage[]>('getPackagesInstalled', token);
    }

    async getPackageMetadata(
        packageNames: string[],
        token?: vscode.CancellationToken,
    ): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
        return fetchMetadataWithOutdated(packageNames, (t) => this._getOutdatedVersions(t), token);
    }

    async getPackageDetail(
        name: string,
        token?: vscode.CancellationToken,
    ): Promise<Partial<positron.LanguageRuntimePackage> | undefined> {
        return this._callMethod<Partial<positron.LanguageRuntimePackage> | undefined>('getPackageDetail', token, name);
    }

    /**
     * Check if uv is available.
     */
    async isUvAvailable(): Promise<boolean> {
        try {
            return await isUvInstalled();
        } catch {
            return false;
        }
    }

    async installPackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensureUv();

        const packageSpecs = this._formatPackageSpecs(packages);
        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv add --active --python <path> <packages>
            const args = ['add', '--active', '--python', this._pythonPath, ...packageSpecs];
            await this._executeUvInTerminal(args, token);
        } else {
            const requirementsPath = await this._getWorkspaceRequirementsPath();
            if (requirementsPath) {
                // requirements.txt is the source of truth: pass the target on the
                // command line plus -r <file> (verbatim). The resolver intersects
                // the target with the file; a conflict fails atomically.
                const args = ['pip', 'install', ...packageSpecs, '-r', requirementsPath, '--python', this._pythonPath];
                await this._executeUvInTerminal(args, token);
                if (isAutoUpdateRequirementsEnabled()) {
                    const installed = (await this.getPackages(token)).map((pkg) => pkg.name);
                    await addInstalledToRequirements(
                        this._serviceContainer.get<IFileSystem>(IFileSystem),
                        requirementsPath,
                        packages.map((pkg) => pkg.name),
                        installed,
                    );
                }
            } else {
                // Re-resolve against the full installed set: name every installed
                // package (bare) plus the new package(s) so an inconsistent install
                // fails atomically instead of breaking the environment.
                const freezeLines = await this._getInstalledFreeze(token);
                const content = buildRequirementsFile(freezeLines, packages);
                const tempFile = await this._writeRequirementsTempFile(content);
                try {
                    const args = ['pip', 'install', '-r', tempFile.filePath, '--python', this._pythonPath];
                    await this._executeUvInTerminal(args, token);
                } finally {
                    tempFile.dispose();
                }
            }
        }
    }

    async uninstallPackages(packages: string[], token?: vscode.CancellationToken): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensureUv();

        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv remove --active --python <path> <packages>
            const args = ['remove', '--active', '--python', this._pythonPath, ...packages];
            await this._executeUvInTerminal(args, token);
        } else {
            // Environment workflow: uv pip uninstall --python <path> <packages>
            const args = ['pip', 'uninstall', '--python', this._pythonPath, ...packages];
            await this._executeUvInTerminal(args, token);

            const requirementsPath = await this._getWorkspaceRequirementsPath();
            if (requirementsPath && isAutoUpdateRequirementsEnabled()) {
                const installed = (await this.getPackages(token)).map((pkg) => pkg.name);
                await removeUninstalledFromRequirements(
                    this._serviceContainer.get<IFileSystem>(IFileSystem),
                    requirementsPath,
                    packages,
                    installed,
                );
            }
        }
    }

    async updatePackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensureUv();

        const packageSpecs = this._formatPackageSpecs(packages);
        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv add --upgrade --active --python <path> <packages>
            const args = ['add', '--upgrade', '--active', '--python', this._pythonPath, ...packageSpecs];
            await this._executeUvInTerminal(args, token);
        } else {
            const missing = packages.find((pkg) => !pkg.version);
            if (missing) {
                throw new Error(`A version is required to update '${missing.name}'.`);
            }
            const requirementsPath = await this._getWorkspaceRequirementsPath();
            if (requirementsPath) {
                // Pin the target(s) on the command line plus -r <file> (verbatim).
                // No --upgrade: an exact pin moves only the named target.
                const args = ['pip', 'install', ...packageSpecs, '-r', requirementsPath, '--python', this._pythonPath];
                await this._executeUvInTerminal(args, token);
            } else {
                // Re-resolve against the full installed set: name every package (bare),
                // pin only the target, so an inconsistent update fails atomically.
                const targets = packages.map((pkg) => ({ name: pkg.name, version: pkg.version! }));
                const freezeLines = await this._getInstalledFreeze(token);
                const content = buildRequirementsFile(freezeLines, targets);
                const tempFile = await this._writeRequirementsTempFile(content);
                try {
                    const args = ['pip', 'install', '-r', tempFile.filePath, '--python', this._pythonPath];
                    await this._executeUvInTerminal(args, token);
                } finally {
                    tempFile.dispose();
                }
            }
        }
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensureUv();

        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv sync --upgrade --active --python <path>
            const args = ['sync', '--upgrade', '--active', '--python', this._pythonPath];
            await this._executeUvInTerminal(args, token);
        } else {
            const outdatedPackages = await this._getOutdatedPackages(token);

            if (outdatedPackages.length === 0) {
                this._emitMessage('All packages are up to date.\n');
                return;
            }

            const requirementsPath = await this._getWorkspaceRequirementsPath();
            if (requirementsPath) {
                // Upgrade everything DECLARED to latest compatible; the file is the
                // source of truth (declared pins block their own upgrade).
                const args = ['pip', 'install', '--upgrade', '-r', requirementsPath, '--python', this._pythonPath];
                await this._executeUvInTerminal(args, token);
            } else {
                // Upgrade every installed package to its latest mutually-compatible
                // version: name them all (bare) and let uv resolve.
                const freezeLines = await this._getInstalledFreeze(token);
                const content = buildRequirementsFile(freezeLines, []);
                const tempFile = await this._writeRequirementsTempFile(content);
                try {
                    const args = ['pip', 'install', '--upgrade', '-r', tempFile.filePath, '--python', this._pythonPath];
                    await this._executeUvInTerminal(args, token);
                } finally {
                    tempFile.dispose();
                }
            }
        }
    }

    async searchPackages(query: string, token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
        return searchPyPI(query, token);
    }

    async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        return searchPyPIVersions(
            name,
            (specs) => this._callMethod<Record<string, boolean>>('checkRequiresPython', token, specs),
            token,
        );
    }

    // =========================================================================
    // Private helper methods
    // =========================================================================

    /**
     * Ensure uv is available, throwing an error if not.
     */
    private async _ensureUv(): Promise<void> {
        const hasUv = await this.isUvAvailable();
        if (!hasUv) {
            throw new Error(
                'uv is not available. ' +
                    'Please install uv to use package management features: https://docs.astral.sh/uv/',
            );
        }
    }

    /**
     * Path to the workspace-root `requirements.txt` if present, else undefined.
     */
    private async _getWorkspaceRequirementsPath(): Promise<string | undefined> {
        const workspaceService = this._serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const fileSystem = this._serviceContainer.get<IFileSystem>(IFileSystem);
        return findWorkspaceRequirementsFile(workspaceService, fileSystem);
    }

    /**
     * Determine whether to use the project-based workflow (uv add) or
     * environment-based workflow (uv pip install).
     *
     * Uses project workflow when:
     * - pyproject.toml exists with a valid [project] section (name + version)
     * - requirements.txt does NOT exist (to avoid sync issues)
     */
    private async _shouldUseProjectWorkflow(): Promise<boolean> {
        const workspaceService = this._serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const fileSystem = this._serviceContainer.get<IFileSystem>(IFileSystem);

        // Get workspace folder
        const workspaceFolder = workspaceService.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        // Check if pyproject.toml exists
        const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
        const pyprojectExists = await fileSystem.fileExists(pyprojectPath);
        if (!pyprojectExists) {
            return false;
        }

        // Check if pyproject.toml has a valid [project] section
        let hasValidProjectSection = false;
        try {
            const pyprojectContent = await fileSystem.readFile(pyprojectPath);
            const hasProjectSection = /^\[project\]/m.test(pyprojectContent);
            const hasName = /^name\s*=/m.test(pyprojectContent);
            const hasVersion = /^version\s*=/m.test(pyprojectContent);
            hasValidProjectSection = hasProjectSection && hasName && hasVersion;
        } catch {
            return false;
        }

        if (!hasValidProjectSection) {
            return false;
        }

        // Check if requirements.txt exists (if so, use pip workflow to avoid sync issues)
        if (await findWorkspaceRequirementsFile(workspaceService, fileSystem)) {
            return false;
        }

        return true;
    }

    /**
     * Capture the full installed set as pinned `uv pip freeze` lines, preserving
     * install origins so already-installed packages resolve as satisfied.
     */
    private async _getInstalledFreeze(token?: vscode.CancellationToken): Promise<string[]> {
        const processServiceFactory = this._serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        const processService = await processServiceFactory.create();
        const proxyEnv = this._getProxyEnv();
        // Force --color never: uv honors FORCE_COLOR/CLICOLOR_FORCE even when its
        // output is piped, and `uv pip freeze` then wraps package names in ANSI
        // codes (e.g. "\x1b[1mscipy\x1b[0m==1.15.3"). Feeding those to
        // `uv pip install -r` makes uv's requirements parser reject the ESC byte.
        const result = await processService.exec(
            'uv',
            ['pip', 'freeze', '--color', 'never', '--python', this._pythonPath],
            {
                extraVariables: proxyEnv,
                token,
            },
        );
        // Empty output is a valid empty environment, not a failure: `uv pip
        // freeze` excludes pip/setuptools/wheel by default, so a fresh env with
        // no user-installed packages prints nothing. Real failures (spawn
        // errors) reject upstream, and a broken resolver surfaces at the actual
        // `install` step.
        if (!result.stdout) {
            return [];
        }
        return result.stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
    }

    /**
     * Write requirements content to a temporary file. Caller must `dispose()`
     * the returned handle when the install completes.
     */
    private async _writeRequirementsTempFile(content: string): Promise<{ filePath: string; dispose: () => void }> {
        const fs = this._serviceContainer.get<IFileSystem>(IFileSystem);
        const tempFile = await fs.createTemporaryFile('.txt');
        await fs.writeFile(tempFile.filePath, content);
        // Log the generated requirements so the resolved set passed to uv can be
        // inspected (the temp file itself is deleted after the command runs).
        traceVerbose(`uv package requirements file ${tempFile.filePath}:\n${content}`);
        return tempFile;
    }

    /**
     * Map of lowercased package name to uv's resolved `latest_version` for
     * outdated installed packages via `uv pip list --outdated`. uv evaluates
     * versions using PEP 440 (via Rust's `pep440_rs`).
     */
    private async _getOutdatedVersions(token?: vscode.CancellationToken): Promise<Map<string, string>> {
        const outdated = await this._getOutdatedPackages(token);
        return new Map(outdated.map((pkg) => [pkg.name.toLowerCase(), pkg.latest_version]));
    }

    /**
     * Get list of outdated packages using uv pip list. Each entry includes
     * uv's resolved `latest_version` (PEP 440 via `pep440_rs`) so callers can
     * surface it directly rather than re-resolving from a separate index.
     */
    private async _getOutdatedPackages(
        token?: vscode.CancellationToken,
    ): Promise<Array<{ name: string; latest_version: string }>> {
        const processServiceFactory = this._serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        const processService = await processServiceFactory.create();
        const proxyEnv = this._getProxyEnv();

        try {
            const result = await processService.exec(
                'uv',
                ['pip', 'list', '--outdated', '--format=json', '--color', 'never', '--python', this._pythonPath],
                { extraVariables: proxyEnv, token },
            );

            if (result.stdout) {
                return JSON.parse(result.stdout);
            }
        } catch {
            throw new Error('Failed to get outdated packages list');
        }

        return [];
    }

    /**
     * Format package install requests into package specifiers.
     * e.g., { name: "requests", version: "2.28.0" } becomes "requests==2.28.0"
     */
    private _formatPackageSpecs(packages: positron.PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
    }

    /**
     * Get proxy environment variables if a proxy is configured in VS Code settings.
     * uv uses standard HTTP_PROXY/HTTPS_PROXY environment variables.
     */
    private _getProxyEnv(): Record<string, string> | undefined {
        const proxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
        if (proxy) {
            return {
                HTTP_PROXY: proxy,
                HTTPS_PROXY: proxy,
            };
        }
        return undefined;
    }

    /**
     * Execute a uv command in the terminal (visible to user).
     * @param args The uv arguments to execute
     * @param token Optional cancellation token
     */
    private async _executeUvInTerminal(args: string[], token?: vscode.CancellationToken): Promise<void> {
        const proxyEnv = this._getProxyEnv();
        const terminalService = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({ env: proxyEnv });
        // Ensure terminal is created and ready before sending command
        await terminalService.show();

        const disposable = token?.onCancellationRequested(async () => {
            // Send Ctrl+C to interrupt the running command
            await terminalService.sendText('\x03');
        });

        try {
            await terminalService.sendCommand('uv', args, token);
        } finally {
            disposable?.dispose();
        }
    }

    /**
     * Call a kernel method with cancellation support.
     * If the token is cancelled, interrupts the kernel (if supported).
     */
    private async _callMethod<T>(method: string, token?: vscode.CancellationToken, ...args: unknown[]): Promise<T> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const resultPromise = this._session.callMethod(method, ...args) as Promise<T>;

        // If no token provided, just return the method result
        if (!token) {
            return resultPromise;
        }

        // Wrap callMethod promise with cancellation handling
        return new Promise<T>((resolve, reject) => {
            const cancelDisp = token.onCancellationRequested(async () => {
                // Interrupt the session via the runtime service
                await positron.runtime.interruptSession(this._session.metadata.sessionId);
                reject(new vscode.CancellationError());
            });

            resultPromise
                .then((result) => {
                    cancelDisp.dispose();
                    resolve(result);
                })
                .catch((err) => {
                    cancelDisp.dispose();
                    reject(err);
                });
        });
    }

    /**
     * Emit a stream message to the console.
     */
    private _emitMessage(text: string, parentId?: string): void {
        this._messageEmitter.fire({
            id: randomUUID(),
            parent_id: parentId ?? '',
            when: new Date().toISOString(),
            type: positron.LanguageRuntimeMessageType.Stream,
            name: positron.LanguageRuntimeStreamName.Stdout,
            text,
        } as positron.LanguageRuntimeStream);
    }
}
