import { QuickInputButtons, QuickPickItem, QuickPickItemButtonEvent, QuickPickItemKind, ThemeIcon, Uri } from 'vscode';
import { launchBrowser } from '../../common/env.apis';
import { Common, PackageManagement } from '../../common/localize';
import { showInputBoxWithButtons, showQuickPickWithButtons, showTextDocument } from '../../common/window.apis';
import { Installable } from './types';

const OPEN_BROWSER_BUTTON = {
    iconPath: new ThemeIcon('globe'),
    tooltip: Common.openInBrowser,
};

const OPEN_EDITOR_BUTTON = {
    iconPath: new ThemeIcon('go-to-file'),
    tooltip: Common.openInEditor,
};

const EDIT_ARGUMENTS_BUTTON = {
    iconPath: new ThemeIcon('add'),
    tooltip: PackageManagement.editArguments,
};

function handleItemButton(uri?: Uri) {
    if (uri) {
        if (uri.scheme.toLowerCase().startsWith('http')) {
            launchBrowser(uri);
        } else {
            showTextDocument(uri);
        }
    }
}

interface PackageQuickPickItem extends QuickPickItem {
    id: string;
    uri?: Uri;
    args?: string[];
}

function getDetail(i: Installable): string | undefined {
    if (i.args && i.args.length > 0) {
        if (i.args.length === 1 && i.args[0] === i.name) {
            return undefined;
        }
        return i.args.join(' ');
    }
    return undefined;
}

function installableToQuickPickItem(i: Installable): PackageQuickPickItem {
    const detail = i.description ? getDetail(i) : undefined;
    const description = i.description ? i.description : getDetail(i);
    const buttons = i.uri
        ? i.uri.scheme.startsWith('http')
            ? [OPEN_BROWSER_BUTTON]
            : [OPEN_EDITOR_BUTTON]
        : undefined;
    return {
        label: i.displayName,
        detail,
        description,
        buttons,
        uri: i.uri,
        args: i.args,
        id: i.name,
    };
}

async function enterPackageManually(filler?: string): Promise<string[] | undefined> {
    const input = await showInputBoxWithButtons({
        placeHolder: PackageManagement.enterPackagesPlaceHolder,
        value: filler,
        ignoreFocusOut: true,
        showBackButton: true,
    });
    return input?.split(' ');
}

interface GroupingResult {
    items: PackageQuickPickItem[];
    installedItems: PackageQuickPickItem[];
}

function groupByInstalled(items: PackageQuickPickItem[], installed?: string[]): GroupingResult {
    const installedItems: PackageQuickPickItem[] = [];
    const result: PackageQuickPickItem[] = [];
    items.forEach((i) => {
        if (installed?.find((p) => i.id === p)) {
            installedItems.push(i);
        } else {
            result.push(i);
        }
    });
    const installedSeparator: PackageQuickPickItem = {
        id: 'installed-sep',
        label: PackageManagement.installed,
        kind: QuickPickItemKind.Separator,
    };
    const commonPackages: PackageQuickPickItem = {
        id: 'common-packages-sep',
        label: PackageManagement.commonPackages,
        kind: QuickPickItemKind.Separator,
    };
    return {
        items: [installedSeparator, ...installedItems, commonPackages, ...result],
        installedItems,
    };
}

interface PackagesPickerResult {
    install: string[];
    uninstall: string[];
}

function selectionsToResult(selections: string[], installed: string[]): PackagesPickerResult {
    const install: string[] = selections;
    const uninstall: string[] = [];
    installed.forEach((i) => {
        if (!selections.find((s) => i === s)) {
            uninstall.push(i);
        }
    });
    return {
        install,
        uninstall,
    };
}

export async function selectFromCommonPackagesToInstall(
    common: Installable[],
    installed: string[],
    preSelected?: PackageQuickPickItem[] | undefined,
    options?: { showBackButton?: boolean } | undefined,
): Promise<PackagesPickerResult | undefined> {
    const { installedItems, items } = groupByInstalled(common.map(installableToQuickPickItem), installed);
    const preSelectedItems = items.filter((i) => (preSelected ?? installedItems).some((s) => s.id === i.id));
    let selected: PackageQuickPickItem | PackageQuickPickItem[] | undefined;
    try {
        selected = await showQuickPickWithButtons(
            items as PackageQuickPickItem[],
            {
                placeHolder: PackageManagement.selectPackagesToInstall,
                ignoreFocusOut: true,
                canPickMany: true,
                showBackButton: options?.showBackButton,
                buttons: [EDIT_ARGUMENTS_BUTTON],
                selected: preSelectedItems,
            },
            undefined,
            (e: QuickPickItemButtonEvent<PackageQuickPickItem>) => {
                handleItemButton(e.item.uri);
            },
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
        if (ex === QuickInputButtons.Back) {
            throw ex;
        } else if (ex.button === EDIT_ARGUMENTS_BUTTON && ex.item) {
            const parts: PackageQuickPickItem[] = Array.isArray(ex.item) ? ex.item : [ex.item];
            selected = [
                {
                    id: PackageManagement.enterPackageNames,
                    label: PackageManagement.enterPackageNames,
                    alwaysShow: true,
                },
                ...parts,
            ];
        }
    }

    if (selected && Array.isArray(selected)) {
        if (selected.find((s) => s.label === PackageManagement.enterPackageNames)) {
            const filtered = selected.filter((s) => s.label !== PackageManagement.enterPackageNames);
            try {
                const selections = await enterPackageManually();
                if (selections) {
                    const selectedResult: PackagesPickerResult = selectionsToResult(selections, installed);
                    // only return the install part, since this button is only for adding to existing selection
                    return { install: selectedResult.install, uninstall: [] };
                }
                return undefined;
            } catch (ex) {
                if (ex === QuickInputButtons.Back) {
                    return selectFromCommonPackagesToInstall(common, installed, filtered);
                }
                return undefined;
            }
        } else {
            return selectionsToResult(
                selected.map((s) => s.id),
                installed,
            );
        }
    }
}

function getGroupedItems(items: Installable[]): PackageQuickPickItem[] {
    const groups = new Map<string, Installable[]>();
    const workspaceInstallable: Installable[] = [];

    items.forEach((i) => {
        if (i.group) {
            let group = groups.get(i.group);
            if (!group) {
                group = [];
                groups.set(i.group, group);
            }
            group.push(i);
        } else {
            workspaceInstallable.push(i);
        }
    });

    const result: PackageQuickPickItem[] = [];
    groups.forEach((group, key) => {
        result.push({
            id: key,
            label: key,
            kind: QuickPickItemKind.Separator,
        });
        result.push(...group.map(installableToQuickPickItem));
    });

    if (workspaceInstallable.length > 0) {
        result.push({
            id: PackageManagement.workspaceDependencies,
            label: PackageManagement.workspaceDependencies,
            kind: QuickPickItemKind.Separator,
        });
        result.push(...workspaceInstallable.map(installableToQuickPickItem));
    }

    return result;
}

export async function selectFromInstallableToInstall(
    installable: Installable[],
    preSelected?: PackageQuickPickItem[],
    options?: { showBackButton?: boolean } | undefined,
): Promise<PackagesPickerResult | undefined> {
    const items: PackageQuickPickItem[] = [];

    if (installable && installable.length > 0) {
        items.push(...getGroupedItems(installable));
    } else {
        return undefined;
    }

    let preSelectedItems = items
        .filter((i) => i.kind !== QuickPickItemKind.Separator)
        .filter((i) =>
            preSelected?.find((s) => s.id === i.id && s.description === i.description && s.detail === i.detail),
        );
    const selected = await showQuickPickWithButtons(
        items,
        {
            placeHolder: PackageManagement.selectPackagesToInstall,
            ignoreFocusOut: true,
            canPickMany: true,
            showBackButton: options?.showBackButton,
            selected: preSelectedItems,
        },
        undefined,
        (e: QuickPickItemButtonEvent<PackageQuickPickItem>) => {
            handleItemButton(e.item.uri);
        },
    );

    if (selected) {
        if (Array.isArray(selected)) {
            return { install: selected.flatMap((s) => s.args ?? []), uninstall: [] };
        } else {
            return { install: selected.args ?? [], uninstall: [] };
        }
    }
    return undefined;
}
