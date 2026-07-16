/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../common/process/types';
import { IFileSystem } from '../../common/platform/types';
import { IWorkspaceService } from '../../common/application/types';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IServiceContainer } from '../../ioc/types';
import { traceVerbose } from '../../logging';
import { fetchMetadataWithOutdated } from './packageMetadata';
import { searchPyPI, searchPyPIVersions } from './pypiSearch';
import { buildRequirementsFile } from './requirementsFile';
import { findWorkspaceRequirementsFile, USE_REQUIREMENTS_FILE_SETTING } from './workspaceRequirements';
import { IPackageManager, MessageEmitter, PackageSession } from './types';

/**
 * Pip Package Manager
 *
 * Provides package management functionality for Python sessions using pip.
 * Runs pip commands as subprocesses and streams output to the Positron Console.
 */
export class PipPackageManager implements IPackageManager {
    private _pythonService: IPythonExecutionService | undefined;

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
     * Check if pip is available in the current Python environment.
     */
    async isPipAvailable(): Promise<boolean> {
        try {
            const pythonService = await this._getPythonService();
            return pythonService.isModuleInstalled('pip');
        } catch {
            return false;
        }
    }

    async installPackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        if (packages.length === 0) {
            return;
        }

        await this._ensurePip();

        const requirementsPath = await this._getWorkspaceRequirementsPath();
        if (requirementsPath) {
            // requirements.txt is the source of truth: pass the target on the
            // command line plus -r <file> (verbatim). The resolver intersects the
            // target with the file; a conflict fails atomically.
            const specs = this._formatPackageSpecs(packages);
            const flags = await this._getInstallFlags();
            const args = ['install', ...specs, '-r', requirementsPath, ...flags];
            await this._executePipInTerminal(args, token);
            return;
        }

        // Re-resolve against the full installed set so the new package can't break
        // the environment: name every installed package (bare) plus the new
        // package(s); an inconsistent install fails atomically.
        const freezeLines = await this._getInstalledFreeze(token);
        const content = buildRequirementsFile(freezeLines, packages);
        const tempFile = await this._writeRequirementsTempFile(content);
        try {
            const flags = await this._getInstallFlags();
            const args = ['install', '-r', tempFile.filePath, ...flags];
            await this._executePipInTerminal(args, token);
        } finally {
            tempFile.dispose();
        }
    }

    async uninstallPackages(packages: string[], token?: vscode.CancellationToken): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensurePip();

        const args = ['uninstall', '-y', ...packages];

        await this._executePipInTerminal(args, token);
    }

    async updatePackages(packages: positron.PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const missing = packages.find((pkg) => !pkg.version);
        if (missing) {
            throw new Error(`A version is required to update '${missing.name}'.`);
        }

        await this._ensurePip();

        const requirementsPath = await this._getWorkspaceRequirementsPath();
        if (requirementsPath) {
            // Pin the target(s) on the command line plus -r <file> (verbatim). No
            // --upgrade: an exact pin moves only the named target.
            const specs = this._formatPackageSpecs(packages);
            const flags = await this._getInstallFlags();
            const args = ['install', ...specs, '-r', requirementsPath, ...flags];
            await this._executePipInTerminal(args, token);
            return;
        }

        // Re-resolve against the full installed set: name every package so all
        // constraints are honored, but only the target is pinned (others are bare
        // and stay put unless the update forces a change). An inconsistent update
        // fails atomically instead of silently breaking the environment.
        const targets = packages.map((pkg) => ({ name: pkg.name, version: pkg.version! }));
        const freezeLines = await this._getInstalledFreeze(token);
        const content = buildRequirementsFile(freezeLines, targets);
        const tempFile = await this._writeRequirementsTempFile(content);
        try {
            const flags = await this._getInstallFlags();
            const args = ['install', '-r', tempFile.filePath, ...flags];
            await this._executePipInTerminal(args, token);
        } finally {
            tempFile.dispose();
        }
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensurePip();

        let outdatedPackages: Array<{ name: string; latest_version: string }>;
        try {
            outdatedPackages = await this._getOutdatedPackages(token);
        } catch {
            throw new Error('Failed to parse outdated packages list');
        }

        if (outdatedPackages.length === 0) {
            this._emitMessage('All packages are up to date.\n');
            return;
        }

        const requirementsPath = await this._getWorkspaceRequirementsPath();
        if (requirementsPath) {
            // Upgrade everything DECLARED to latest compatible; the file is the
            // source of truth (declared pins block their own upgrade).
            const flags = await this._getInstallFlags();
            const args = ['install', '--upgrade', '-r', requirementsPath, ...flags];
            await this._executePipInTerminal(args, token);
            return;
        }

        // Upgrade every installed package to its latest mutually-compatible
        // version: name them all (bare) and let pip resolve. All constraints are
        // honored; an impossible set fails atomically.
        const freezeLines = await this._getInstalledFreeze(token);
        const content = buildRequirementsFile(freezeLines, []);
        const tempFile = await this._writeRequirementsTempFile(content);
        try {
            const flags = await this._getInstallFlags();
            const args = ['install', '--upgrade', '-r', tempFile.filePath, ...flags];
            await this._executePipInTerminal(args, token);
        } finally {
            tempFile.dispose();
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
     * Get or create the Python execution service.
     */
    private async _getPythonService(): Promise<IPythonExecutionService> {
        if (!this._pythonService) {
            const factory = this._serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            this._pythonService = await factory.create({ pythonPath: this._pythonPath });
        }
        return this._pythonService;
    }

    /**
     * Map of lowercased package name to pip's resolved `latest_version` for
     * outdated installed packages. pip uses `packaging.version` (PEP 440)
     * for the comparison.
     */
    private async _getOutdatedVersions(token?: vscode.CancellationToken): Promise<Map<string, string>> {
        if (!(await this.isPipAvailable())) {
            return new Map();
        }
        const outdated = await this._getOutdatedPackages(token);
        return new Map(outdated.map((pkg) => [pkg.name.toLowerCase(), pkg.latest_version]));
    }

    /**
     * Get outdated installed packages via `pip list --outdated`. Returns the
     * raw `{name, latest_version}[]` shape so callers can either pass the
     * names back to `pip install --upgrade` or build a name -> latest version
     * lookup. Assumes pip is already available; callers must check
     * `isPipAvailable()` if they aren't already gated by `_ensurePip()`.
     */
    private async _getOutdatedPackages(
        token?: vscode.CancellationToken,
    ): Promise<Array<{ name: string; latest_version: string }>> {
        const pythonService = await this._getPythonService();
        const proxyFlags = this._getProxyFlags();
        const result = await pythonService.execModule(
            'pip',
            ['list', '--outdated', '--format=json', '--no-color', ...proxyFlags],
            {
                token,
            },
        );
        return JSON.parse(result.stdout) as Array<{ name: string; latest_version: string }>;
    }

    /**
     * Format package install requests into pip package specifiers.
     * e.g., { name: "requests", version: "2.28.0" } becomes "requests==2.28.0".
     */
    private _formatPackageSpecs(packages: positron.PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
    }

    /**
     * Path to the workspace-root `requirements.txt` if present, else undefined.
     */
    private async _getWorkspaceRequirementsPath(): Promise<string | undefined> {
        // Opt-out: when the setting is disabled, ignore requirements.txt so all
        // operations fall back to the pip freeze re-resolve path.
        if (!vscode.workspace.getConfiguration('python').get<boolean>(USE_REQUIREMENTS_FILE_SETTING, true)) {
            return undefined;
        }
        const workspaceService = this._serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const fileSystem = this._serviceContainer.get<IFileSystem>(IFileSystem);
        return findWorkspaceRequirementsFile(workspaceService, fileSystem);
    }

    /**
     * Capture the full installed set as pinned `pip freeze` lines. Origins
     * (`@ file://`, `-e`, VCS URLs) are preserved so already-installed packages
     * resolve as satisfied without an index lookup.
     */
    private async _getInstalledFreeze(token?: vscode.CancellationToken): Promise<string[]> {
        const pythonService = await this._getPythonService();
        // --no-color defensively: pip doesn't colorize `freeze` today, but
        // FORCE_COLOR/CLICOLOR_FORCE could lead to ANSI codes that would corrupt
        // the requirements file fed to `pip install -r` (as uv does -- see #14328).
        const result = await pythonService.execModule('pip', ['freeze', '--no-color'], { token });
        // Empty output is a valid empty environment, not a failure: `pip freeze`
        // excludes pip/setuptools/wheel by default, so a fresh env with no
        // user-installed packages prints nothing. Real failures (missing pip,
        // spawn errors) throw upstream in execModule, and a broken resolver
        // surfaces at the actual `install` step.
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
        // Log the generated requirements so the resolved set passed to pip can be
        // inspected (the temp file itself is deleted after the command runs).
        traceVerbose(`pip package requirements file ${tempFile.filePath}:\n${content}`);
        return tempFile;
    }

    /**
     * Ensure pip is available, throwing an error if not.
     */
    private async _ensurePip(): Promise<void> {
        const hasPip = await this.isPipAvailable();
        if (!hasPip) {
            throw new Error(
                'pip is not available in this Python environment. ' +
                    'Please install pip to use package management features.',
            );
        }
    }

    /**
     * Get proxy flags if a proxy is configured.
     */
    private _getProxyFlags(): string[] {
        const proxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
        if (proxy) {
            return ['--proxy', proxy];
        }
        return [];
    }

    /**
     * Get installation flags based on the Python environment type.
     */
    private async _getInstallFlags(): Promise<string[]> {
        const flags: string[] = [...this._getProxyFlags()];
        return flags;
    }

    /**
     * Execute a pip command in the terminal (visible to user).
     * @param args The pip arguments to execute
     * @param token Optional cancellation token
     */
    private async _executePipInTerminal(args: string[], token?: vscode.CancellationToken): Promise<void> {
        const terminalService = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({});
        // Ensure terminal is created and ready before sending command
        await terminalService.show();

        const disposable = token?.onCancellationRequested(async () => {
            // Send Ctrl+C to interrupt the running command
            await terminalService.sendText('\x03');
        });

        try {
            await terminalService.sendCommand(this._pythonPath, ['-m', 'pip', ...args], token);
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
