/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from '../common/platform/fs-paths';
import { getOSType, OSType } from '../common/utils/platform';
import { traceVerbose, traceWarn } from '../logging';
import { IInterpreterService } from '../interpreter/contracts';
import { isBaseCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { getNativePythonFinder } from '../pythonEnvironments/base/locators/common/nativePythonFinder';
import { NativePythonEnvironmentKind } from '../pythonEnvironments/base/locators/common/nativePythonUtils';

/**
 * PET kinds that are always managed by the operating system or a package manager.
 *
 * Homebrew is included unconditionally because a `brew upgrade` replaces the binary
 * even when the PEP 668 marker file is absent.
 */
const EXTERNALLY_MANAGED_KINDS: readonly NativePythonEnvironmentKind[] = [
    NativePythonEnvironmentKind.Homebrew,
    NativePythonEnvironmentKind.MacCommandLineTools,
    NativePythonEnvironmentKind.MacXCode,
    NativePythonEnvironmentKind.LinuxGlobal,
];

/** Directories whose Pythons belong to the OS package manager. */
const SYSTEM_BIN_DIRECTORIES: readonly string[] = ['/usr/bin', '/bin'];

/** The inputs the predicate needs. Gathered by {@link probeExternallyManagedEnvironment}. */
export interface ExternallyManagedSignals {
    /** Absolute path to the interpreter executable. */
    interpreterPath: string;
    /** PET's environment kind, or undefined when PET could not resolve the interpreter. */
    nativeKind: NativePythonEnvironmentKind | undefined;
    /** The environment Positron resolved for the interpreter, if any. */
    environment: PythonEnvironment | undefined;
}

/**
 * Whether an interpreter is externally managed in the PEP 668 sense: installing
 * packages into it with pip can break other software on the machine.
 *
 * Cheap checks only, and fails open -- an interpreter this cannot classify is
 * reported as not externally managed so that sessions start as they do today.
 */
export async function isExternallyManagedEnvironment(signals: ExternallyManagedSignals): Promise<boolean> {
    const { interpreterPath, nativeKind, environment } = signals;

    if (nativeKind !== undefined && EXTERNALLY_MANAGED_KINDS.includes(nativeKind)) {
        return true;
    }

    if (environment && isBaseCondaEnvironment(environment)) {
        return true;
    }

    // A virtual environment is the thing this feature would offer to create, so never
    // flag one. Conda reaches here only when it is not the base environment.
    if (environment && isVirtualEnvironmentType(environment.envType)) {
        return false;
    }

    if (await hasExternallyManagedMarker(environment)) {
        return true;
    }

    return isSystemBinPath(interpreterPath);
}

/**
 * Gather the detection signals for an interpreter and classify it.
 *
 * Returns the resolved environment alongside the verdict because callers need it for
 * the interpreter's display name and version.
 */
export async function probeExternallyManagedEnvironment(
    interpreterPath: string,
    interpreterService: IInterpreterService,
): Promise<{ externallyManaged: boolean; environment: PythonEnvironment | undefined }> {
    let environment: PythonEnvironment | undefined;
    try {
        const [resolved, nativeKind] = await Promise.all([
            interpreterService.getInterpreterDetails(interpreterPath),
            resolveNativeKind(interpreterPath),
        ]);
        environment = resolved;
        const externallyManaged = await isExternallyManagedEnvironment({
            interpreterPath,
            nativeKind,
            environment,
        });
        return { externallyManaged, environment };
    } catch (error) {
        traceWarn(`Could not determine whether ${interpreterPath} is externally managed: ${error}`);
        return { externallyManaged: false, environment };
    }
}

/**
 * PET's kind for an interpreter. The kind is needed because Positron's own
 * `EnvironmentType` collapses Homebrew, Xcode, Command Line Tools, python.org, and
 * distro Pythons all into `System`, which is too coarse to act on.
 */
async function resolveNativeKind(interpreterPath: string): Promise<NativePythonEnvironmentKind | undefined> {
    try {
        const info = await getNativePythonFinder().resolve(interpreterPath);
        return info?.kind;
    } catch (error) {
        traceVerbose(`Could not resolve the environment kind for ${interpreterPath}: ${error}`);
        return undefined;
    }
}

/**
 * Environment types that are already isolated from the rest of the machine.
 *
 * `Uv` is deliberately absent: PET reports the same kind for uv-managed base Pythons
 * and for uv virtual environments, so only the PEP 668 marker distinguishes them.
 * `Pyenv` is absent for the same reason and falls through to the marker check, which
 * correctly leaves both pyenv installs and pyenv-virtualenvs unflagged.
 */
function isVirtualEnvironmentType(envType: EnvironmentType): boolean {
    switch (envType) {
        case EnvironmentType.Venv:
        case EnvironmentType.VirtualEnv:
        case EnvironmentType.VirtualEnvWrapper:
        case EnvironmentType.Pipenv:
        case EnvironmentType.Poetry:
        case EnvironmentType.Hatch:
        case EnvironmentType.Pixi:
        case EnvironmentType.Conda:
            return true;
        default:
            return false;
    }
}

/** Whether the environment carries the PEP 668 `EXTERNALLY-MANAGED` marker file. */
async function hasExternallyManagedMarker(environment: PythonEnvironment | undefined): Promise<boolean> {
    const sysPrefix = environment?.sysPrefix;
    if (!sysPrefix) {
        return false;
    }

    // `path.win32` / `path.posix` rather than `path.join` so that the layout follows the
    // environment being inspected instead of the host running the code. This keeps the
    // unit tests deterministic on every developer platform.
    let markerPath: string;
    if (getOSType() === OSType.Windows) {
        markerPath = path.win32.join(sysPrefix, 'Lib', 'EXTERNALLY-MANAGED');
    } else {
        const major = environment?.version?.major;
        const minor = environment?.version?.minor;
        if (major === undefined || minor === undefined || major < 0 || minor < 0) {
            return false;
        }
        markerPath = path.posix.join(sysPrefix, 'lib', `python${major}.${minor}`, 'EXTERNALLY-MANAGED');
    }

    try {
        return await fs.pathExists(markerPath);
    } catch (error) {
        traceVerbose(`Could not stat ${markerPath}: ${error}`);
        return false;
    }
}

/** Whether the interpreter lives in a directory owned by the OS package manager. */
function isSystemBinPath(interpreterPath: string): boolean {
    if (getOSType() === OSType.Windows) {
        return false;
    }
    return SYSTEM_BIN_DIRECTORIES.includes(path.posix.dirname(interpreterPath));
}
