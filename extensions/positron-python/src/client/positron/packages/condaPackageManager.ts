/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IComponentAdapter, ICondaService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { IPackageManager, MessageEmitter } from './types';

/**
 * Conda Package Manager
 *
 * Provides package management functionality for Python sessions using conda.
 * Runs conda commands in the terminal and streams output to the user.
 */
export class CondaPackageManager implements IPackageManager {
    constructor(
        private readonly _pythonPath: string,
        _messageEmitter: MessageEmitter,
        private readonly _serviceContainer: IServiceContainer,
    ) {}

    /**
     * Check if conda is available.
     */
    async isCondaAvailable(): Promise<boolean> {
        try {
            const condaService = this._serviceContainer.get<ICondaService>(ICondaService);
            return await condaService.isCondaAvailable();
        } catch {
            return false;
        }
    }

    async installPackages(packages: positron.PackageSpec[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensureConda();

        const packageSpecs = this._formatPackageSpecs(packages);
        const envPrefix = await this._getEnvironmentPrefix();
        const args = ['install', '--prefix', envPrefix, '-y', ...packageSpecs];

        await this._executeCondaInTerminal(args);
    }

    async uninstallPackages(packages: string[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensureConda();

        const envPrefix = await this._getEnvironmentPrefix();
        const args = ['remove', '--prefix', envPrefix, '-y', ...packages];

        await this._executeCondaInTerminal(args);
    }

    async updatePackages(packages: positron.PackageSpec[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        await this._ensureConda();

        const packageSpecs = this._formatPackageSpecs(packages);
        const envPrefix = await this._getEnvironmentPrefix();
        // Use 'install' instead of 'update' because conda update doesn't support version specs.
        // conda install will update (or downgrade) to the specified version.
        const args = ['install', '--prefix', envPrefix, '-y', ...packageSpecs];

        await this._executeCondaInTerminal(args);
    }

    async updateAllPackages(): Promise<void> {
        await this._ensureConda();

        const envPrefix = await this._getEnvironmentPrefix();
        const args = ['update', '--prefix', envPrefix, '--all', '-y'];

        await this._executeCondaInTerminal(args);
    }

    // =========================================================================
    // Private helper methods
    // =========================================================================

    /**
     * Ensure conda is available, throwing an error if not.
     */
    private async _ensureConda(): Promise<void> {
        const hasConda = await this.isCondaAvailable();
        if (!hasConda) {
            throw new Error('conda is not available. ' + 'Please install conda to use package management features.');
        }
    }

    /**
     * Get the conda environment prefix path for the current Python interpreter.
     */
    private async _getEnvironmentPrefix(): Promise<string> {
        const componentAdapter = this._serviceContainer.get<IComponentAdapter>(IComponentAdapter);
        const condaEnvInfo = await componentAdapter.getCondaEnvironment(this._pythonPath);

        if (!condaEnvInfo?.path) {
            throw new Error(
                'Could not determine conda environment path. ' +
                    'Ensure this Python interpreter is part of a conda environment.',
            );
        }

        return condaEnvInfo.path;
    }

    /**
     * Get the conda executable path.
     * Uses shell execution on Windows to work around HTTP issues with conda.exe.
     */
    private async _getCondaFile(): Promise<string> {
        const condaService = this._serviceContainer.get<ICondaService>(ICondaService);
        // Use shell execution which uses conda.bat on Windows, avoiding HTTP issues
        // https://github.com/conda/conda/issues/11399
        return condaService.getCondaFile(true);
    }

    /**
     * Format package install requests into conda package specifiers.
     * e.g., { name: "requests", version: "2.28.0" } becomes "requests==2.28.0"
     */
    private _formatPackageSpecs(packages: positron.PackageSpec[]): string[] {
        return packages.map((pkg) => (pkg.version ? `${pkg.name}==${pkg.version}` : pkg.name));
    }

    /**
     * Execute a conda command in the terminal (visible to user).
     */
    private async _executeCondaInTerminal(args: string[]): Promise<void> {
        const condaFile = await this._getCondaFile();
        const terminalService = this._serviceContainer
            .get<ITerminalServiceFactory>(ITerminalServiceFactory)
            .getTerminalService({});
        // Ensure terminal is created and ready before sending command
        await terminalService.show();
        const tokenSource = new vscode.CancellationTokenSource();
        try {
            await terminalService.sendCommand(condaFile, args, tokenSource.token);
        } finally {
            tokenSource.dispose();
        }
    }
}
