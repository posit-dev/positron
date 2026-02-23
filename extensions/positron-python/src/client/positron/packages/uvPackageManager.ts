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

/**
 * Interface for emitting messages to the Positron console
 */
interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

/**
 * UV Package Manager
 *
 * Provides package management functionality for Python sessions using uv.
 * Supports two workflows:
 * - Project workflow: Uses `uv add`/`uv remove` when a valid pyproject.toml exists
 * - Environment workflow: Uses `uv pip install`/`uv pip uninstall` otherwise
 */
export class UvPackageManager {
    constructor(
        private readonly _pythonPath: string,
        private readonly _messageEmitter: MessageEmitter,
        private readonly _serviceContainer: IServiceContainer,
    ) {}

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

    async installPackages(packages: positron.PackageSpec[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensureUv();

        const packageSpecs = this._formatPackageSpecs(packages);
        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv add --active --python <path> <packages>
            const args = ['add', '--active', '--python', this._pythonPath, ...packageSpecs];
            await this._executeUvInTerminal(args);
        } else {
            // Environment workflow: uv pip install --python <path> <packages>
            const args = ['pip', 'install', '--python', this._pythonPath, ...packageSpecs];
            await this._executeUvInTerminal(args);
        }
    }

    async uninstallPackages(packages: string[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensureUv();

        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv remove --active --python <path> <packages>
            const args = ['remove', '--active', '--python', this._pythonPath, ...packages];
            await this._executeUvInTerminal(args);
        } else {
            // Environment workflow: uv pip uninstall --python <path> <packages>
            const args = ['pip', 'uninstall', '--python', this._pythonPath, ...packages];
            await this._executeUvInTerminal(args);
        }
    }

    async updatePackages(packages: positron.PackageSpec[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensureUv();

        const packageSpecs = this._formatPackageSpecs(packages);
        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv add --upgrade --active --python <path> <packages>
            const args = ['add', '--upgrade', '--active', '--python', this._pythonPath, ...packageSpecs];
            await this._executeUvInTerminal(args);
        } else {
            // Environment workflow: uv pip install --upgrade --python <path> <packages>
            const args = ['pip', 'install', '--upgrade', '--python', this._pythonPath, ...packageSpecs];
            await this._executeUvInTerminal(args);
        }
    }

    async updateAllPackages(): Promise<void> {
        await this._ensureUv();

        const useProjectWorkflow = await this._shouldUseProjectWorkflow();

        if (useProjectWorkflow) {
            // Project workflow: uv sync --upgrade --active --python <path>
            const args = ['sync', '--upgrade', '--active', '--python', this._pythonPath];
            await this._executeUvInTerminal(args);
        } else {
            // Environment workflow: get outdated packages and upgrade them
            const outdatedPackages = await this._getOutdatedPackages();

            if (outdatedPackages.length === 0) {
                this._emitMessage('All packages are up to date.\n');
                return;
            }

            const packageNames = outdatedPackages.map((pkg) => pkg.name);
            const args = ['pip', 'install', '--upgrade', '--python', this._pythonPath, ...packageNames];
            await this._executeUvInTerminal(args);
        }
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
        let workspaceFolder = workspaceService.workspaceFolders?.[0];
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
        const requirementsPath = path.join(workspacePath, 'requirements.txt');
        const requirementsExists = await fileSystem.fileExists(requirementsPath);
        if (requirementsExists) {
            return false;
        }

        return true;
    }

    /**
     * Get list of outdated packages using uv pip list.
     */
    private async _getOutdatedPackages(): Promise<Array<{ name: string }>> {
        const processServiceFactory = this._serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        const processService = await processServiceFactory.create();
        const proxyEnv = this._getProxyEnv();

        try {
            const result = await processService.exec(
                'uv',
                ['pip', 'list', '--outdated', '--format=json', '--python', this._pythonPath],
                { extraVariables: proxyEnv },
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
     */
    private async _executeUvInTerminal(args: string[]): Promise<void> {
        const proxyEnv = this._getProxyEnv();
        const terminalService = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({ env: proxyEnv });
        // Ensure terminal is created and ready before sending command
        await terminalService.show();
        const tokenSource = new vscode.CancellationTokenSource();
        try {
            await terminalService.sendCommand('uv', args, tokenSource.token);
        } finally {
            tokenSource.dispose();
        }
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
