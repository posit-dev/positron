/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * How the interpreter picker groups and labels Python runtimes.
 *
 * Groups depend on where an interpreter lives, never on settings or shell state:
 * cached runtime metadata is shared across workspace folders.
 */

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { isBaseCondaEnvironment } from '../interpreter/configuration/environmentTypeComparer';
import { NativePythonEnvironmentKind } from '../pythonEnvironments/base/locators/common/nativePythonUtils';
import { EnvironmentType, PythonEnvironment } from '../pythonEnvironments/info';
import { isPyenvVirtualenv, isUvBase, isWorkspaceEnv, RankingContext } from './interpreterRanking';

/** Picker groups, in display order. The values are stable keys; see groupHeader for display text. */
export enum PythonPickerGroup {
    Project = 'Project environments',
    Global = 'Global environments',
    Base = 'Base interpreters',
    ExternallyManaged = 'Externally managed',
}

/** The localized header text for a picker group. */
function groupHeader(group: PythonPickerGroup): string {
    switch (group) {
        case PythonPickerGroup.Project:
            return vscode.l10n.t('Project environments');
        // Base interpreters share the Global header: both are places to pip
        // install. Base's higher groupOrder keeps its rows last in the group.
        case PythonPickerGroup.Global:
        case PythonPickerGroup.Base:
            return vscode.l10n.t('Global environments');
        case PythonPickerGroup.ExternallyManaged:
            return vscode.l10n.t('Externally managed');
    }
}

const GROUP_ORDER: readonly PythonPickerGroup[] = [
    PythonPickerGroup.Project,
    PythonPickerGroup.Global,
    PythonPickerGroup.Base,
    PythonPickerGroup.ExternallyManaged,
];

/** The `groupOrder` of the project environments group; stable regardless of localization. */
export const PROJECT_GROUP_ORDER = GROUP_ORDER.indexOf(PythonPickerGroup.Project);

/** Whether the picker lists a runtime under Project environments. */
export function isProjectEnvironment(runtime: positron.LanguageRuntimeMetadata): boolean {
    return runtime.picker?.groupOrder === PROJECT_GROUP_ORDER;
}

/** The parts of the ranking context that grouping reads. */
export type PickerGroupContext = Pick<
    RankingContext,
    'workspacePath' | 'homeInsideWorkspace' | 'nestedEnvDirs' | 'uvPythonInstallDirs'
>;

const BASE_ENV_TYPES: readonly EnvironmentType[] = [
    EnvironmentType.System,
    EnvironmentType.Global,
    EnvironmentType.MicrosoftStore,
    EnvironmentType.Unknown,
    EnvironmentType.Custom,
    EnvironmentType.Module,
];

/** The picker group of an interpreter; the first matching rule wins. */
export function pickerGroupOf(
    interpreter: PythonEnvironment,
    context: PickerGroupContext,
    externallyManaged: boolean,
): PythonPickerGroup {
    if (isWorkspaceEnv(interpreter, context)) {
        return PythonPickerGroup.Project;
    }
    if (isUvBase(interpreter, context) || isBaseCondaEnvironment(interpreter) || externallyManaged) {
        return PythonPickerGroup.ExternallyManaged;
    }
    if (
        (interpreter.envType === EnvironmentType.Pyenv && !isPyenvVirtualenv(interpreter)) ||
        BASE_ENV_TYPES.includes(interpreter.envType)
    ) {
        return PythonPickerGroup.Base;
    }
    return PythonPickerGroup.Global;
}

const TOOL_NAMES: ReadonlyMap<EnvironmentType, string> = new Map([
    [EnvironmentType.Uv, 'uv'],
    [EnvironmentType.Conda, 'conda'],
    [EnvironmentType.Pyenv, 'pyenv'],
    [EnvironmentType.Venv, 'venv'],
    [EnvironmentType.VirtualEnv, 'virtualenv'],
    [EnvironmentType.VirtualEnvWrapper, 'virtualenvwrapper'],
    [EnvironmentType.Pipenv, 'pipenv'],
    [EnvironmentType.Poetry, 'Poetry'],
    [EnvironmentType.Hatch, 'Hatch'],
    [EnvironmentType.Pixi, 'Pixi'],
    [EnvironmentType.MicrosoftStore, 'Microsoft Store'],
    [EnvironmentType.ActiveState, 'ActiveState'],
    [EnvironmentType.Module, 'Module'],
]);

/** Tool names for `System` and `Global` Pythons, by PET kind. */
const INSTALLER_NAMES: ReadonlyMap<NativePythonEnvironmentKind, string> = new Map([
    [NativePythonEnvironmentKind.Homebrew, 'Homebrew'],
    [NativePythonEnvironmentKind.MacXCode, 'Xcode'],
    [NativePythonEnvironmentKind.MacCommandLineTools, 'Command Line Tools'],
    [NativePythonEnvironmentKind.MacPythonOrg, 'python.org'],
]);

/** The tool that made or manages the interpreter, e.g. `uv` or `Homebrew`, if known. */
function pythonToolName(
    interpreter: PythonEnvironment,
    runtimeSource: EnvironmentType,
    context: PickerGroupContext,
): string | undefined {
    if (isUvBase(interpreter, context)) {
        return 'uv';
    }
    if (runtimeSource === EnvironmentType.System || runtimeSource === EnvironmentType.Global) {
        return interpreter.nativeKind ? INSTALLER_NAMES.get(interpreter.nativeKind) : undefined;
    }
    return TOOL_NAMES.get(runtimeSource);
}

/** The picker group, label and gray text for a Python runtime. */
export function createPythonPickerInfo(args: {
    interpreter: PythonEnvironment;
    runtimeSource: EnvironmentType;
    envName: string;
    pythonVersion: string;
    supported: boolean;
    context: PickerGroupContext;
    externallyManaged: boolean;
}): positron.RuntimePickerInfo {
    const { interpreter, runtimeSource, pythonVersion, supported, context, externallyManaged } = args;
    const group = pickerGroupOf(interpreter, context, externallyManaged);
    const envName = args.envName === pythonVersion ? '' : args.envName;
    const toolAndName = [pythonToolName(interpreter, runtimeSource, context), envName].filter(Boolean).join(': ');
    const description = [toolAndName, supported ? undefined : vscode.l10n.t('not supported')]
        .filter(Boolean)
        .join(' \u00B7 ');
    return {
        group: groupHeader(group),
        groupOrder: GROUP_ORDER.indexOf(group),
        rowOrder: supported ? 0 : 1,
        label: `Python ${pythonVersion}`,
        description: description || undefined,
    };
}
