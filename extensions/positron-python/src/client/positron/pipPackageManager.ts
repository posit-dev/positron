/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { IPythonExecutionFactory, IPythonExecutionService } from '../common/process/types';
import { ITerminalServiceFactory } from '../common/terminal/types';
import { IServiceContainer } from '../ioc/types';

/**
 * Interface for emitting messages to the Positron console
 */
interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

/**
 * Pip Package Manager
 *
 * Provides package management functionality for Python sessions using pip.
 * Runs pip commands as subprocesses and streams output to the Positron Console.
 */
export class PipPackageManager {
    private _pythonService: IPythonExecutionService | undefined;

    constructor(
        protected readonly _pythonPath: string,
        protected readonly _messageEmitter: MessageEmitter,
        protected readonly _serviceContainer: IServiceContainer,
    ) {}

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

    /**
     * Install one or more packages.
     * @param packages Array of package install requests with name and optional version
     */
    async installPackages(packages: positron.PackageSpec[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensurePip();

        const packageSpecs = this._formatPackageSpecs(packages);
        const flags = await this._getInstallFlags();
        const args = ['install', ...flags, ...packageSpecs];

        await this._executePipInTerminal(args);
    }

    /**
     * Uninstall one or more packages.
     */
    async uninstallPackages(packages: string[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensurePip();

        const args = ['uninstall', '-y', ...packages];

        await this._executePipInTerminal(args);
    }

    /**
     * Update specific packages to latest versions.
     * @param packages Array of package install requests with name and optional version
     */
    async updatePackages(packages: positron.PackageSpec[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensurePip();

        const packageSpecs = this._formatPackageSpecs(packages);
        const flags = await this._getInstallFlags();
        const args = ['install', '--upgrade', ...flags, ...packageSpecs];

        await this._executePipInTerminal(args);
    }

    /**
     * Update all installed packages to their latest versions.
     */
    async updateAllPackages(): Promise<void> {
        await this._ensurePip();

        // First, get list of outdated packages
        const proxyFlags = this._getProxyFlags();

        const pythonService = await this._getPythonService();
        const outdatedResult = await pythonService.execModule(
            'pip',
            ['list', '--outdated', '--format=json', ...proxyFlags],
            {},
        );

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

        await this._executePipInTerminal(args);
    }

    // =========================================================================
    // Protected helper methods
    // =========================================================================

    /**
     * Get or create the Python execution service.
     */
    protected async _getPythonService(): Promise<IPythonExecutionService> {
        if (!this._pythonService) {
            const factory = this._serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            this._pythonService = await factory.create({ pythonPath: this._pythonPath });
        }
        return this._pythonService;
    }

    /**
     * Ensure pip is available, throwing an error if not.
     */
    protected async _ensurePip(): Promise<void> {
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
    protected _formatPackageSpecs(packages: positron.PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
    }

    /**
     * Get proxy flags if a proxy is configured.
     */
    protected _getProxyFlags(): string[] {
        const proxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
        if (proxy) {
            return ['--proxy', proxy];
        }
        return [];
    }

    /**
     * Get installation flags based on the Python environment type.
     */
    protected async _getInstallFlags(): Promise<string[]> {
        const flags: string[] = [...this._getProxyFlags()];
        return flags;
    }

    /**
     * Execute a pip command in the terminal (visible to user).
     */
    protected async _executePipInTerminal(args: string[]): Promise<void> {
        const terminalService = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({});
        // Ensure terminal is created and ready before sending command
        await terminalService.show();
        const tokenSource = new vscode.CancellationTokenSource();
        try {
            await terminalService.sendCommand(this._pythonPath, ['-m', 'pip', ...args], tokenSource.token);
        } finally {
            tokenSource.dispose();
        }
    }

    /**
     * Emit a stream message to the console.
     */
    protected _emitMessage(text: string, parentId?: string): void {
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
