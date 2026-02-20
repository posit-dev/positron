/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServiceContainer } from '../../ioc/types';
import { EnvironmentType } from '../../pythonEnvironments/info';
import { PipPackageManager } from './pipPackageManager';
import { IPackageManager, MessageEmitter } from './types';
import { UvPackageManager } from './uvPackageManager';

/**
 * Package manager types for Python environments.
 * Used to identify which package manager is handling package operations.
 */
export enum PackageManagerType {
    Pip = 'Pip',
    Venv = 'Venv',
    Uv = 'Uv',
}

/**
 * Factory for creating the appropriate package manager based on environment type.
 *
 * This factory examines the Python environment type and returns the corresponding
 * package manager implementation:
 * - Uv environments use UvPackageManager
 * - All other environments use PipPackageManager as the default
 */
export class PackageManagerFactory {
    /**
     * Create the appropriate package manager for the given environment.
     *
     * @param runtimeSource The environment type (e.g., 'Venv', 'Conda', 'Global', 'Uv')
     * @param pythonPath The path to the Python interpreter
     * @param messageEmitter The emitter for runtime messages
     * @param serviceContainer The service container for dependency injection
     * @returns The appropriate package manager for the environment
     */
    static create(
        runtimeSource: EnvironmentType | string,
        pythonPath: string,
        messageEmitter: MessageEmitter,
        serviceContainer: IServiceContainer,
    ): IPackageManager {
        // Check if the environment is a uv-managed environment
        if (runtimeSource === EnvironmentType.Uv) {
            return new UvPackageManager(pythonPath, messageEmitter, serviceContainer);
        } else if (runtimeSource === EnvironmentType.Venv) {
            return new PipPackageManager(pythonPath, messageEmitter, serviceContainer);
        }

        // Default to PipPackageManager for all other environment types
        // This includes Conda, Pyenv, Global, System, VirtualEnv, etc.
        return new PipPackageManager(pythonPath, messageEmitter, serviceContainer);
    }
}
