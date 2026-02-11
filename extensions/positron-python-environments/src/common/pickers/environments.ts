import { ProgressLocation, QuickInputButtons, QuickPickItem, QuickPickItemKind, ThemeIcon, Uri } from 'vscode';
import { CreateEnvironmentOptions, IconPath, PythonEnvironment, PythonProject } from '../../api';
import { InternalEnvironmentManager } from '../../internal.api';
import { Common, Interpreter, Pickers } from '../localize';
import { traceError } from '../logging';
import { EventNames } from '../telemetry/constants';
import { sendTelemetryEvent } from '../telemetry/sender';
import { isWindows } from '../utils/platformUtils';
import { handlePythonPath } from '../utils/pythonPath';
import { showOpenDialog, showQuickPick, showQuickPickWithButtons, withProgress } from '../window.apis';
import { pickEnvironmentManager } from './managers';

type QuickPickIcon =
    | Uri
    | {
          light: Uri;
          dark: Uri;
      }
    | ThemeIcon
    | undefined;

function getIconPath(i: IconPath | undefined): QuickPickIcon {
    if (i === undefined || i instanceof ThemeIcon || i instanceof Uri) {
        return i;
    }

    if (typeof i === 'string') {
        return Uri.file(i);
    }

    return {
        light: i.light instanceof Uri ? i.light : Uri.file(i.light),
        dark: i.dark instanceof Uri ? i.dark : Uri.file(i.dark),
    };
}

interface EnvironmentPickOptions {
    recommended?: PythonEnvironment;
    showBackButton?: boolean;
    projects: PythonProject[];
}
async function browseForPython(
    managers: InternalEnvironmentManager[],
    projectEnvManagers: InternalEnvironmentManager[],
): Promise<PythonEnvironment | undefined> {
    const filters = isWindows() ? { python: ['exe'] } : undefined;
    const uris = await showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters,
        title: Pickers.Environments.selectExecutable,
    });
    if (!uris || uris.length === 0) {
        return;
    }
    const uri = uris[0];

    const environment = await withProgress(
        {
            location: ProgressLocation.Notification,
            cancellable: false,
        },
        async (reporter, token) => {
            const env = await handlePythonPath(uri, managers, projectEnvManagers, reporter, token);
            return env;
        },
    );
    return environment;
}

async function createEnvironment(
    managers: InternalEnvironmentManager[],
    projectEnvManagers: InternalEnvironmentManager[],
    options: EnvironmentPickOptions,
): Promise<PythonEnvironment | undefined> {
    const managerId = await pickEnvironmentManager(
        managers.filter((m) => m.supportsCreate),
        projectEnvManagers.filter((m) => m.supportsCreate),
    );

    let manager: InternalEnvironmentManager | undefined;
    let createOptions: CreateEnvironmentOptions | undefined = undefined;
    if (managerId?.includes(`QuickCreate#`)) {
        manager = managers.find((m) => m.id === managerId.split('#')[1]);
        createOptions = {
            projects: projectEnvManagers.map((m) => m),
            quickCreate: true,
        } as CreateEnvironmentOptions;
    } else {
        manager = managers.find((m) => m.id === managerId);
    }

    if (manager) {
        try {
            // add telemetry here
            const env = await manager.create(
                options.projects.map((p) => p.uri),
                createOptions,
            );
            return env;
        } catch (ex) {
            if (ex === QuickInputButtons.Back) {
                return createEnvironment(managers, projectEnvManagers, options);
            }
            traceError(`Failed to create environment using ${manager.id}`, ex);
            throw ex;
        }
    }
}

async function pickEnvironmentImpl(
    items: (QuickPickItem | (QuickPickItem & { result: PythonEnvironment }))[],
    managers: InternalEnvironmentManager[],
    projectEnvManagers: InternalEnvironmentManager[],
    options: EnvironmentPickOptions,
): Promise<PythonEnvironment | undefined> {
    const selected = await showQuickPickWithButtons(items, {
        placeHolder: Pickers.Environments.selectEnvironment,
        ignoreFocusOut: true,
        showBackButton: options?.showBackButton,
    });

    if (selected && !Array.isArray(selected)) {
        if (selected.label === Interpreter.browsePath) {
            return browseForPython(managers, projectEnvManagers);
        } else if (selected.label === Interpreter.createVirtualEnvironment) {
            sendTelemetryEvent(EventNames.CREATE_ENVIRONMENT, undefined, {
                manager: 'none',
                triggeredLocation: 'pickEnv',
            });
            return createEnvironment(managers, projectEnvManagers, options);
        }
        return (selected as { result: PythonEnvironment })?.result;
    }
    return undefined;
}

export async function pickEnvironment(
    managers: InternalEnvironmentManager[],
    projectEnvManagers: InternalEnvironmentManager[],
    options: EnvironmentPickOptions,
): Promise<PythonEnvironment | undefined> {
    const items: (QuickPickItem | (QuickPickItem & { result: PythonEnvironment }))[] = [
        {
            label: Interpreter.browsePath,
            iconPath: new ThemeIcon('folder'),
        },
        {
            label: '',
            kind: QuickPickItemKind.Separator,
        },
        {
            label: Interpreter.createVirtualEnvironment,
            iconPath: new ThemeIcon('add'),
        },
    ];

    if (options?.recommended) {
        const pathDescription = options.recommended.displayPath;
        const description =
            options.recommended.description && options.recommended.description.trim()
                ? `${options.recommended.description} (${pathDescription})`
                : pathDescription;

        items.push(
            {
                label: Common.recommended,
                kind: QuickPickItemKind.Separator,
            },
            {
                label: options.recommended.displayName,
                description: description,
                result: options.recommended,
                iconPath: getIconPath(options.recommended.iconPath),
            },
        );
    }

    for (const manager of managers) {
        items.push({
            label: manager.displayName,
            kind: QuickPickItemKind.Separator,
        });
        const envs = await manager.getEnvironments('all');
        items.push(
            ...envs.map((e) => {
                const pathDescription = e.displayPath;
                const description =
                    e.description && e.description.trim() ? `${e.description} (${pathDescription})` : pathDescription;

                return {
                    label: e.displayName ?? e.name,
                    description: description,
                    result: e,
                    manager: manager,
                    iconPath: getIconPath(e.iconPath),
                };
            }),
        );
    }

    return pickEnvironmentImpl(items, managers, projectEnvManagers, options);
}

export async function pickEnvironmentFrom(environments: PythonEnvironment[]): Promise<PythonEnvironment | undefined> {
    const items = environments.map((e) => {
        const pathDescription = e.displayPath;
        const description =
            e.description && e.description.trim() ? `${e.description} (${pathDescription})` : pathDescription;

        return {
            label: e.displayName ?? e.name,
            description: description,
            e: e,
            iconPath: getIconPath(e.iconPath),
        };
    });
    const selected = await showQuickPick(items, {
        placeHolder: Pickers.Environments.selectEnvironment,
        ignoreFocusOut: true,
    });
    return (selected as { e: PythonEnvironment })?.e;
}
