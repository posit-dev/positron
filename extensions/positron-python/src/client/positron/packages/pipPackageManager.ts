/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../common/process/types';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IServiceContainer } from '../../ioc/types';
import { searchPyPI, searchPyPIVersions } from './pypiSearch';
import { IPackageManager, MessageEmitter, PackageKernel } from './types';

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
        private readonly _kernel: PackageKernel,
    ) {}

    async getPackages(token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        const result = await this._kernel.callMethod('getPackagesInstalled');
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        return result;
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
        if (packages.length === 0) {
            return;
        }

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensurePip();

        const packageSpecs = this._formatPackageSpecs(packages);
        const flags = await this._getInstallFlags();
        const args = ['install', ...flags, ...packageSpecs];

        await this._executePipInTerminal(args, token);
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

        await this._ensurePip();

        const packageSpecs = this._formatPackageSpecs(packages);
        const flags = await this._getInstallFlags();
        const args = ['install', '--upgrade', ...flags, ...packageSpecs];

        await this._executePipInTerminal(args, token);
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        await this._ensurePip();

        // First, get list of outdated packages
        const proxyFlags = this._getProxyFlags();

        const pythonService = await this._getPythonService();
        const outdatedResult = await pythonService.execModule(
            'pip',
            ['list', '--outdated', '--format=json', ...proxyFlags],
            {},
        );

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        let outdatedPackages: Array<{ name: string }> = [];
        try {
            outdatedPackages = JSON.parse(outdatedResult.stdout);
        } catch {
            throw new Error('Failed to parse outdated packages list');
        }

        if (outdatedPackages.length === 0) {
            this._emitMessage('All packages are up to date.\n');
            return;
        }

        const packageNames = outdatedPackages.map((pkg) => pkg.name);
        const flags = await this._getInstallFlags();
        const args = ['install', '--upgrade', ...flags, ...packageNames];

        await this._executePipInTerminal(args, token);
    }

    async searchPackages(query: string, token?: vscode.CancellationToken): Promise<positron.LanguageRuntimePackage[]> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        // TODO: Pass token to searchPyPI for fetch cancellation
        const result = await searchPyPI(query);
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        return result;
    }

    async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        // TODO: Pass token to searchPyPIVersions for fetch cancellation
        const result = await searchPyPIVersions(name);
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        return result;
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
     * Format package install requests into pip package specifiers.
     * e.g., { name: "requests", version: "2.28.0" } becomes "requests==2.28.0"
     */
    private _formatPackageSpecs(packages: positron.PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
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

        // Use external token if provided, otherwise create internal one
        const tokenSource = token ? undefined : new vscode.CancellationTokenSource();
        const effectiveToken = token ?? tokenSource!.token;

        try {
            await terminalService.sendCommand(this._pythonPath, ['-m', 'pip', ...args], effectiveToken);
        } finally {
            tokenSource?.dispose();
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
