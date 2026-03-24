/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServiceContainer } from '../../ioc/types';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { CondaPackageManager } from './condaPackageManager';
import { PipPackageManager } from './pipPackageManager';
import { IPackageManager, MessageEmitter, PackageSession } from './types';
import { UvPackageManager } from './uvPackageManager';

/**
 * Factory for creating the appropriate package manager based on environment type.
 *
 * This factory examines the Python environment type and returns the corresponding
 * package manager implementation, with a fallback to PipPackageManager.
 */
export class PackageManagerFactory {
    /**
     * Create the appropriate package manager for the given environment.
     *
     * @param runtimeSource The environment type (e.g., 'Venv', 'Conda', 'Global', 'uv')
     * @param pythonPath The path to the Python interpreter
     * @param messageEmitter The emitter for runtime messages
     * @param serviceContainer The service container for dependency injection
     * @param session The session for RPC-based package operations
     * @returns The appropriate package manager for the environment
     */
    static create(
        runtimeSource: EnvironmentType | string | undefined,
        pythonPath: string,
        messageEmitter: MessageEmitter,
        serviceContainer: IServiceContainer,
        session: PackageSession,
    ): IPackageManager {
        if (runtimeSource?.toLowerCase() === EnvironmentType.Uv.toLowerCase()) {
            return new UvPackageManager(pythonPath, messageEmitter, serviceContainer, session);
        }

        if (runtimeSource?.toLowerCase() === EnvironmentType.Conda.toLowerCase()) {
            return new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, session);
        }

        if (runtimeSource?.toLowerCase() === EnvironmentType.Venv.toLowerCase()) {
            return new PipPackageManager(pythonPath, messageEmitter, serviceContainer, session);
        }

        // Default to PipPackageManager for all other environment types
        // This includes Pyenv, Global, System, VirtualEnv, etc.
        return new PipPackageManager(pythonPath, messageEmitter, serviceContainer, session);
    }
}
