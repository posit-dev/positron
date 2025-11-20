// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { LogOutputChannel } from 'vscode';
import { PythonEnvKind } from '../../info';
import { traceError } from '../../../../logging';

export enum NativePythonEnvironmentKind {
    Conda = 'Conda',
    Pixi = 'Pixi',
    Homebrew = 'Homebrew',
    Pyenv = 'Pyenv',
    GlobalPaths = 'GlobalPaths',
    PyenvVirtualEnv = 'PyenvVirtualEnv',
    Pipenv = 'Pipenv',
    Poetry = 'Poetry',
    // --- Start Positron ---
    Uv = 'Uv',
    Custom = 'Custom',
    // --- End Positron ---
    MacPythonOrg = 'MacPythonOrg',
    MacCommandLineTools = 'MacCommandLineTools',
    LinuxGlobal = 'LinuxGlobal',
    MacXCode = 'MacXCode',
    Venv = 'Venv',
    VirtualEnv = 'VirtualEnv',
    VirtualEnvWrapper = 'VirtualEnvWrapper',
    WindowsStore = 'WindowsStore',
    WindowsRegistry = 'WindowsRegistry',
    // --- Start Positron ---
    // Disabling UvVenv since PET does not have a release that uses it yet.
    // We currently have our own implementation of `Uv`, that we may want to
    // swap out once PET can handle this.
    // VenvUv = 'Uv',
    // --- End Positron ---
}

const mapping = new Map<NativePythonEnvironmentKind, PythonEnvKind>([
    [NativePythonEnvironmentKind.Conda, PythonEnvKind.Conda],
    [NativePythonEnvironmentKind.Pixi, PythonEnvKind.Pixi],
    [NativePythonEnvironmentKind.GlobalPaths, PythonEnvKind.OtherGlobal],
    [NativePythonEnvironmentKind.Pyenv, PythonEnvKind.Pyenv],
    [NativePythonEnvironmentKind.PyenvVirtualEnv, PythonEnvKind.Pyenv],
    [NativePythonEnvironmentKind.Pipenv, PythonEnvKind.Pipenv],
    [NativePythonEnvironmentKind.Poetry, PythonEnvKind.Poetry],
    // --- Start Positron ---
    [NativePythonEnvironmentKind.Uv, PythonEnvKind.Uv],
    // --- End Positron ---
    [NativePythonEnvironmentKind.VirtualEnv, PythonEnvKind.VirtualEnv],
    [NativePythonEnvironmentKind.VirtualEnvWrapper, PythonEnvKind.VirtualEnvWrapper],
    [NativePythonEnvironmentKind.Venv, PythonEnvKind.Venv],
    // --- Start Positron ---
    // Disabling UvVenv since PET does not have a release that uses it yet.
    // We currently have our own implementation of `Uv`, that we may want to
    // swap out once PET can handle this.
    // [NativePythonEnvironmentKind.VenvUv, PythonEnvKind.Venv],
    // --- End Positron ---
    [NativePythonEnvironmentKind.WindowsRegistry, PythonEnvKind.System],
    [NativePythonEnvironmentKind.WindowsStore, PythonEnvKind.MicrosoftStore],
    [NativePythonEnvironmentKind.Homebrew, PythonEnvKind.System],
    [NativePythonEnvironmentKind.LinuxGlobal, PythonEnvKind.System],
    [NativePythonEnvironmentKind.MacCommandLineTools, PythonEnvKind.System],
    [NativePythonEnvironmentKind.MacPythonOrg, PythonEnvKind.System],
    [NativePythonEnvironmentKind.MacXCode, PythonEnvKind.System],
    // --- Start Positron ---
    [NativePythonEnvironmentKind.Custom, PythonEnvKind.Custom],
    // --- End Positron ---
]);

export function categoryToKind(category?: NativePythonEnvironmentKind, logger?: LogOutputChannel): PythonEnvKind {
    if (!category) {
        return PythonEnvKind.Unknown;
    }
    const kind = mapping.get(category);
    if (kind) {
        return kind;
    }

    if (logger) {
        logger.error(`Unknown Python Environment category '${category}' from Native Locator.`);
    } else {
        traceError(`Unknown Python Environment category '${category}' from Native Locator.`);
    }
    return PythonEnvKind.Unknown;
}
