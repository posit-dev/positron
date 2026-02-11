import { commands, QuickInputButtons, QuickPickItem, QuickPickItemKind, workspace, WorkspaceFolder } from 'vscode';
import { PythonProjectCreator } from '../../api';
import { InternalEnvironmentManager, InternalPackageManager } from '../../internal.api';
import { Common, Pickers } from '../localize';
import { showQuickPickWithButtons } from '../window.apis';

function getDescription(mgr: InternalEnvironmentManager | InternalPackageManager): string | undefined {
    if (mgr.description) {
        return mgr.description;
    }
    if (mgr.tooltip) {
        const tooltip = mgr.tooltip;
        if (typeof tooltip === 'string') {
            return tooltip;
        }
        return tooltip.value;
    }
    return undefined;
}

export async function pickEnvironmentManager(
    managers: InternalEnvironmentManager[],
    defaultManagers?: InternalEnvironmentManager[],
    showBackButton?: boolean,
): Promise<string | undefined> {
    if (managers.length === 0) {
        return;
    }

    if (managers.length === 1 && !managers[0].supportsQuickCreate) {
        // If there's only one manager and it doesn't support quick create, return its ID directly.
        return managers[0].id;
    }

    const items: (QuickPickItem | (QuickPickItem & { id: string }))[] = [];
    if (defaultManagers && defaultManagers.length > 0) {
        items.push({
            label: Common.recommended,
            kind: QuickPickItemKind.Separator,
        });
        if (defaultManagers.length === 1 && defaultManagers[0].supportsQuickCreate) {
            const defaultMgr = defaultManagers[0];
            const details = defaultMgr.quickCreateConfig();
            if (details) {
                items.push({
                    label: Common.quickCreate,
                    description: `${defaultMgr.displayName} • ${details.description}`,
                    detail: details.detail,
                    id: `QuickCreate#${defaultMgr.id}`,
                });
            }
        }
        items.push(
            ...defaultManagers.map((defaultMgr) => ({
                label: defaultMgr.displayName,
                description: getDescription(defaultMgr),
                id: defaultMgr.id,
            })),
            {
                label: '',
                kind: QuickPickItemKind.Separator,
            },
        );
    }
    items.push(
        ...managers
            .filter((m) => !defaultManagers?.includes(m))
            .map((m) => ({
                label: m.displayName,
                description: getDescription(m),
                id: m.id,
            })),
    );
    const item = await showQuickPickWithButtons(items, {
        placeHolder: Pickers.Managers.selectEnvironmentManager,
        ignoreFocusOut: true,
        showBackButton,
    });
    return (item as QuickPickItem & { id: string })?.id;
}

export async function pickPackageManager(
    managers: InternalPackageManager[],
    defaultManagers?: InternalPackageManager[],
): Promise<string | undefined> {
    if (managers.length === 0) {
        return;
    }

    if (managers.length === 1) {
        return managers[0].id;
    }

    const items: (QuickPickItem | (QuickPickItem & { id: string }))[] = [];
    if (defaultManagers && defaultManagers.length > 0) {
        items.push(
            {
                label: Common.recommended,
                kind: QuickPickItemKind.Separator,
            },
            ...defaultManagers.map((defaultMgr) => ({
                label: defaultMgr.displayName,
                description: getDescription(defaultMgr),
                id: defaultMgr.id,
            })),
            {
                label: '',
                kind: QuickPickItemKind.Separator,
            },
        );
    }
    items.push(
        ...managers
            .filter((m) => !defaultManagers?.includes(m))
            .map((m) => ({
                label: m.displayName,
                description: getDescription(m),
                id: m.id,
            })),
    );
    const item = await showQuickPickWithButtons(items, {
        placeHolder: Pickers.Managers.selectPackageManager,
        ignoreFocusOut: true,
    });
    return (item as QuickPickItem & { id: string })?.id;
}

export async function pickWorkspaceFolder(showBackButton = true): Promise<WorkspaceFolder | undefined> {
    const folders = workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    if (folders.length === 1) {
        return folders[0];
    }
    const items = folders.map((f) => ({
        label: f.name,
        description: f.uri.fsPath,
        folder: f,
    }));

    const selected = await showQuickPickWithButtons(items, {
        placeHolder: 'Select a workspace folder',
        ignoreFocusOut: true,
        showBackButton,
    });
    if (!selected) {
        return undefined;
    }
    const selectedItem = Array.isArray(selected) ? selected[0] : selected;
    return selectedItem?.folder;
}
export async function pickCreator(creators: PythonProjectCreator[]): Promise<PythonProjectCreator | undefined> {
    if (creators.length === 0) {
        return;
    }

    if (creators.length === 1) {
        return creators[0];
    }

    // First level menu
    const autoFindCreator = creators.find((c) => c.name === 'autoProjects');
    const existingProjectsCreator = creators.find((c) => c.name === 'existingProjects');

    const items: QuickPickItem[] = [
        {
            label: 'Auto Find',
            description: autoFindCreator?.description ?? 'Automatically find Python projects',
        },
        {
            label: 'Select Existing',
            description: existingProjectsCreator?.description ?? 'Select existing Python projects',
        },
        {
            label: 'Create New',
            description: 'Create a Python project from a template',
        },
    ];

    const selected = await showQuickPickWithButtons(items, {
        placeHolder: Pickers.Managers.selectProjectCreator,
        ignoreFocusOut: true,
        showBackButton: true,
    });

    if (!selected) {
        return undefined;
    }

    // Return appropriate creator based on selection
    // Handle case where selected could be an array (should not happen, but for type safety)
    const selectedItem = Array.isArray(selected) ? selected[0] : selected;
    if (!selectedItem) {
        return undefined;
    }
    switch (selectedItem.label) {
        case 'Auto Find':
            return autoFindCreator;
        case 'Select Existing':
            return existingProjectsCreator;
        case 'Create New':
            return newProjectSelection(creators);
    }

    return undefined;
}

export async function newProjectSelection(creators: PythonProjectCreator[]): Promise<PythonProjectCreator | undefined> {
    const otherCreators = creators.filter((c) => c.name !== 'autoProjects' && c.name !== 'existingProjects');

    // Show second level menu for other creators
    if (otherCreators.length === 0) {
        return undefined;
    }
    const newItems: (QuickPickItem & { c: PythonProjectCreator })[] = otherCreators.map((c) => ({
        label: c.displayName ?? c.name,
        description: c.description,
        c: c,
    }));
    try {
        const newSelected = await showQuickPickWithButtons(newItems, {
            placeHolder: 'Select project type for new project',
            ignoreFocusOut: true,
            showBackButton: true,
        });

        if (!newSelected) {
            // User cancelled the picker
            return undefined;
        }
        // Handle back button
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((newSelected as any)?.kind === -1 || (newSelected as any)?.back === true) {
            // User pressed the back button, re-show the first menu
            return pickCreator(creators);
        }

        // Handle case where newSelected could be an array (should not happen, but for type safety)
        const selectedCreator = Array.isArray(newSelected) ? newSelected[0] : newSelected;
        return selectedCreator?.c;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            await commands.executeCommand('python-envs.addPythonProject');
        }
    }
}
