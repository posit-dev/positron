/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import * as nls from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { positronSessionViewIcon } from '../../positronSession/browser/positronSessionContainer.js';
import { PositronPackagesView } from './positronPackagesView.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { installPackage, uninstallPackage, updatePackage } from './positronPackagesQuickPick.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronPackagesService } from './positronPackagesService.js';
import { ILanguageRuntimePackage } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';

export const POSITRON_PACKAGES_VIEW_CONTAINER_ID = 'workbench.viewContainer.positronPackages';
export const POSITRON_PACKAGES_VIEW_ID = 'workbench.view.positronPackages.view';

const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_PACKAGES_VIEW_CONTAINER_ID,
	title: nls.localize2('packages', 'Packages'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_PACKAGES_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'workbench.packages.views.state',
	icon: Codicon.package,
	alwaysUseContainerInfo: true,
	hideIfEmpty: true,
	order: 51,
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.openPackages',
		title: nls.localize2('positronPackages.openPackages', 'Packages'),
		mnemonicTitle: nls.localize('positronPackages.openPackagesMnemonic', 'Packages'),
		keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV },
		order: 0
	},
}, ViewContainerLocation.Sidebar, { isDefault: false });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_PACKAGES_VIEW_ID,
			name: {
				value: nls.localize('positron.packages', 'Packages'),
				original: 'Packages'
			},
			ctorDescriptor: new SyncDescriptor(PositronPackagesView),
			canToggleVisibility: false,
			canMoveView: true,
			containerIcon: positronSessionViewIcon,
			when: ContextKeyExpr.equals('config.positron.environments.enable', true)
		}
	],
	viewContainer
);

export const PACKAGES_INSTALL_COMMAND_ID = 'positronPackages.installPackage';
export const PACKAGES_UPDATE_COMMAND_ID = 'positronPackages.updatePackage';
export const PACKAGES_UPDATE_ALL_COMMAND_ID = 'positronPackages.updateAllPackages';
export const PACKAGES_UNINSTALL_COMMAND_ID = 'positronPackages.uninstallPackage';
export const PACKAGES_REFRESH_COMMAND_ID = 'positronPackages.refreshPackages';

class RefreshPackagesAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_REFRESH_COMMAND_ID,
			title: nls.localize2('refreshPackages', 'Refresh Packages'),
			category: Categories.Developer,
			f1: true,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 3,
			},
		});
	}
	override run(accessor: ServicesAccessor, ...args: unknown[]): Promise<ILanguageRuntimePackage[]> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		try {
			return service.refreshPackages();
		} catch (error) {
			notifications.error(error);
			throw error;
		}
	}
}


class InstallPackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_INSTALL_COMMAND_ID,
			title: nls.localize2('installPackage', 'Install Package'),
			category: Categories.Developer,
			f1: true,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 3,
			},
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		try {
			const performSearch = async (q: string) => {
				return await service.searchPackages(q);
			};

			const performSearchVersions = async (pkg: string) => {
				return await service.searchPackageVersions(pkg);
			};

			const performInstall = async (pkg: string, version?: string): Promise<void> => {
				if (!version) {
					throw new Error('No version specified.');
				}

				await progress.withProgress({
					title: nls.localize('positronPackages.installingPackages', 'Installing Packages...'),
					location: ProgressLocation.Notification,
					delay: 500
				}, async (_progress) => {
					try {
						await service.installPackages([`${pkg}@${version}`]);
					} catch (e) {
						notifications.notify({
							severity: Severity.Error,
							actions: {
								primary: [{
									id: 'viewLogs',
									label: nls.localize('positronPackages.viewLogs', 'View Logs'),
									tooltip: nls.localize('positronPackages.viewLogs', 'View Logs'),
									enabled: true,
									class: undefined,
									run: () => service.activeSession?.showOutput(),
								}]
							},
							message: nls.localize('positronPackages.failedToInstallPackage', "Failed to install package: '{0}'", pkg),
						});
					}
				});
			};

			await installPackage(accessor, performSearch, performSearchVersions, performInstall);
		} catch (error) {
			notifications.error(error);
			throw error;
		}
	}
}

class UninstallPackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_UNINSTALL_COMMAND_ID,
			title: nls.localize2('uninstallPackage', 'Uninstall Package'),
			category: Categories.Developer,
			f1: true,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 3,
			},
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const commands = accessor.get<ICommandService>(ICommandService);
		const dialogService = accessor.get<IDialogService>(IDialogService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		try {
			const performSearch = async () => {
				const packages = await commands.executeCommand(PACKAGES_REFRESH_COMMAND_ID) as ILanguageRuntimePackage[];
				return packages
					.map((x) => ({
						name: x.displayName
					}));
			};

			const performUninstall = async (pkg: string, version?: string): Promise<void> => {
				await progress.withProgress({
					title: nls.localize('positronPackages.uninstallingPackages', 'Uninstalling Packages...'),
					location: ProgressLocation.Notification,
					delay: 500
				}, async (_progress) => {
					try {
						await service.uninstallPackages([pkg]);
					} catch (e) {
						notifications.notify({
							severity: Severity.Error,
							actions: {
								primary: [{
									id: 'viewLogs',
									label: nls.localize('positronPackages.viewLogs', 'View Logs'),
									tooltip: nls.localize('positronPackages.viewLogs', 'View Logs'),
									enabled: true,
									class: undefined,
									run: () => service.activeSession?.showOutput(),
								}]
							},
							message: nls.localize('positronPackages.failedToUninstallPackage', "Failed to uninstall package: '{0}'", pkg),
						});
					}
				});
			};

			const argPackage = args.at(0) as string | undefined;
			if (argPackage) {
				const res = await dialogService.confirm({
					message: nls.localize('positronPackages.confirmUninstallPackage', "Are you sure you want to uninstall the package '{0}'?", argPackage)
				});
				if (res.confirmed) {
					await performUninstall(argPackage);
				}
			} else {
				await uninstallPackage(accessor, performSearch, performUninstall);
			}
		} catch (error) {
			notifications.error(error);
			throw error;
		}

	}
}

class UpdatePackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_UPDATE_COMMAND_ID,
			title: nls.localize2('updatePackage', 'Update Package'),
			category: Categories.Developer,
			f1: true,
			menu: {
				id: MenuId.ViewItemContext,
				when: ContextKeyExpr.equals('view', POSITRON_PACKAGES_VIEW_ID),
				group: 'navigation',
				order: 1
			}
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const commands = accessor.get<ICommandService>(ICommandService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		try {
			const performSearch = async () => {
				const packages = await commands.executeCommand(PACKAGES_REFRESH_COMMAND_ID) as ILanguageRuntimePackage[];
				return packages
					.map((x) => ({
						name: x.displayName
					}));
			};

			const performSearchVersions = async (pkg: string) => {
				return await service.searchPackageVersions(pkg);
			};

			const performUpdate = async (pkg: string, version: string): Promise<void> => {

				await progress.withProgress({
					title: nls.localize('positronPackages.updatingPackages', 'Updating Packages...'),
					location: ProgressLocation.Notification,
					delay: 500
				}, async (_progress) => {
					try {
						await service.updatePackages([`${pkg}@${version}`]);
					} catch (e) {
						notifications.notify({
							severity: Severity.Error,
							actions: {
								primary: [{
									id: 'viewLogs',
									label: nls.localize('positronPackages.viewLogs', 'View Logs'),
									tooltip: nls.localize('positronPackages.viewLogs', 'View Logs'),
									enabled: true,
									class: undefined,
									run: () => service.activeSession?.showOutput(),
								}]
							},
							message: nls.localize('positronPackages.failedToUpdatePackage', "Failed to update package: '{0}'", pkg),
						});
					}
				});
			};

			const arg0 = args.at(0) as string | undefined;
			await updatePackage(accessor, performSearch, performSearchVersions, performUpdate, arg0);
		} catch (error) {
			notifications.error(error);
			throw error;
		}
	}
}

class UpdateAllPackagesAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_UPDATE_ALL_COMMAND_ID,
			title: nls.localize2('updateAllPackages', 'Update All Packages'),
			category: Categories.Developer,
			f1: true,
			menu: {
				id: MenuId.ViewItemContext,
				when: ContextKeyExpr.equals('view', POSITRON_PACKAGES_VIEW_ID),
				group: 'navigation',
				order: 1
			}
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		await progress.withProgress({
			title: nls.localize('positronPackages.updatingPackages', 'Updating Packages...'),
			location: ProgressLocation.Notification,
			delay: 500
		}, async (_progress) => {
			try {
				await service.updateAllPackages();
			} catch (e) {
				notifications.notify({
					severity: Severity.Error,
					actions: {
						primary: [{
							id: 'viewLogs',
							label: nls.localize('positronPackages.viewLogs', 'View Logs'),
							tooltip: nls.localize('positronPackages.viewLogs', 'View Logs'),
							enabled: true,
							class: undefined,
							run: () => service.activeSession?.showOutput(),
						}]
					},
					message: nls.localize('positronPackages.failedToUpdateAllPackages', "Failed to update all packages"),
				});
			}
		});
	}
}

registerAction2(InstallPackageAction);
registerAction2(RefreshPackagesAction);
registerAction2(UninstallPackageAction);
registerAction2(UpdatePackageAction);
registerAction2(UpdateAllPackagesAction);
registerSingleton(IPositronPackagesService, PositronPackagesService, InstantiationType.Delayed);
