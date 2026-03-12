/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IProcessServiceFactory } from '../../common/process/types';
import { ITerminalServiceFactory } from '../../common/terminal/types';
import { IComponentAdapter, ICondaService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { IPackageManager, MessageEmitter, PackageKernel } from './types';

/** Package info returned by `conda search --json` */
interface CondaPackageInfo {
    version: string;
    timestamp: number;
}

type CondaSearchResult = Record<string, CondaPackageInfo[]>;

/**
 * Parse and validate conda search JSON output.
 * TODO: Replace with an alternative like Zod at some point.
 */
function parseCondaSearchResult(jsonString: string): CondaSearchResult {
    const parsed: unknown = JSON.parse(jsonString);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Expected conda search result to be an object');
    }

    const result: CondaSearchResult = {};
    for (const [name, packages] of Object.entries(parsed)) {
        if (!Array.isArray(packages)) {
            throw new Error(`Expected packages for "${name}" to be an array`);
        }
        result[name] = packages.map((pkg, index) => {
            if (typeof pkg !== 'object' || pkg === null) {
                throw new Error(`Expected package at ${name}[${index}] to be an object`);
            }
            const { version, timestamp } = pkg as Record<string, unknown>;
            if (typeof version !== 'string') {
                throw new Error(`Expected version at ${name}[${index}] to be a string`);
            }
            if (typeof timestamp !== 'number') {
                throw new Error(`Expected timestamp at ${name}[${index}] to be a number`);
            }
            return { version, timestamp };
        });
    }

    return result;
}

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
        private readonly _kernel: PackageKernel,
    ) {}

    async getPackages(): Promise<positron.LanguageRuntimePackage[]> {
        return this._kernel.callMethod('getPackagesInstalled');
    }

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
        // Use installPackages() because conda update doesn't support version specs.
        // conda install will update (or downgrade) to the specified version.
        return this.installPackages(packages);
    }

    async updateAllPackages(): Promise<void> {
        await this._ensureConda();

        const envPrefix = await this._getEnvironmentPrefix();
        const args = ['update', '--prefix', envPrefix, '--all', '-y'];

        await this._executeCondaInTerminal(args);
    }

    async searchPackages(query: string): Promise<positron.LanguageRuntimePackage[]> {
        await this._ensureConda();

        try {
            // Use wildcard pattern for partial matching
            const result = await this._executeCondaWithOutput(['search', `*${query}*`, '--json']);
            const json = parseCondaSearchResult(result);

            // Return unique package names with the latest version (sorted by timestamp)
            return Object.keys(json).map((name) => {
                const versions = json[name];
                const latest = versions.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
                return {
                    id: name,
                    name: name,
                    displayName: name,
                    version: latest.version,
                };
            });
        } catch {
            // Return empty array if search fails (e.g., no matches)
            return [];
        }
    }

    async searchPackageVersions(name: string): Promise<string[]> {
        await this._ensureConda();

        try {
            const result = await this._executeCondaWithOutput(['search', name, '--json']);
            const json = parseCondaSearchResult(result);

            // Get all unique versions for this package
            const packageInfo = json[name];
            if (!packageInfo) {
                return [];
            }

            // Sort by timestamp descending and extract unique versions
            const sorted = [...packageInfo].sort((a, b) => b.timestamp - a.timestamp);
            const versions = [...new Set(sorted.map((p) => p.version))];
            return versions;
        } catch {
            return [];
        }
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

    /**
     * Execute a conda command and capture stdout.
     */
    private async _executeCondaWithOutput(args: string[]): Promise<string> {
        const condaFile = await this._getCondaFile();
        const processServiceFactory = this._serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory);
        const processService = await processServiceFactory.create();

        const result = await processService.exec(condaFile, args);
        return result.stdout;
    }
}
