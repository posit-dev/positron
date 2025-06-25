/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { injectable, inject } from 'inversify';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { Commands } from '../../constants';
import { ICommandManager } from '../types';
import { IDisposableRegistry } from '../../types';
import { IInstallationChannelManager, ModuleInstallFlags } from '../../installer/types';
import { Product } from '../../types';

@injectable()
export class InstallPackagesCommandHandler implements IExtensionSingleActivationService {
    public readonly supportedWorkspaceTypes = { untrustedWorkspace: false, virtualWorkspace: false };

    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IInstallationChannelManager) private readonly channelManager: IInstallationChannelManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
    ) {}

    public async activate(): Promise<void> {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.InstallPackages, this.installPackages, this),
        );
    }

    /**
     * Installs Python packages using the appropriate package manager for the current environment.
     * @param packages Array of package names to install
     * @returns Promise resolving to array of installation result messages
     * @throws Error with prefixed error codes for structured error handling:
     *   - `[NO_INSTALLER]` - No compatible package installer found for environment
     *   - `[VALIDATION_ERROR]` - Invalid or missing package names provided
     *   - Other errors may be thrown by underlying installation system without prefixes
     */
    public async installPackages(packages: string[]): Promise<string[]> {
        // Input validation
        if (!packages || packages.length === 0) {
            throw new Error('[VALIDATION_ERROR] At least one package name must be provided');
        }

        const invalidPackages = packages.filter((pkg) => !pkg || typeof pkg !== 'string' || pkg.trim().length === 0);
        if (invalidPackages.length > 0) {
            throw new Error('[VALIDATION_ERROR] All package names must be non-empty strings');
        }
        const results: string[] = [];

        // Get installer once upfront to avoid repeated calls
        const installer = await this.channelManager.getInstallationChannel(Product.pip, undefined);
        if (!installer) {
            throw new Error('[NO_INSTALLER] No compatible package installer found for current environment');
        }

        // Process each package individually, continuing on failures
        // Note: We don't throw on individual package failures because:
        // 1. The Assistant can intelligently parse mixed success/failure results
        // 2. Partial success is often valuable (e.g., pandas works even if matplotlib fails)
        // 3. Detailed per-package feedback helps the Assistant make better decisions
        for (const packageName of packages) {
            try {
                await installer.installModule(packageName, undefined, undefined, ModuleInstallFlags.none, undefined);
                results.push(`${packageName} installed successfully using ${installer.displayName}`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                results.push(`${packageName}: Installation failed - ${errorMsg}`);
                // Continue with next package to provide complete installation report
            }
        }

        return results;
    }
}
