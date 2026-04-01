/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
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
import { installPackage, uninstallPackage, updatePackage } from './positronPackagesQuickPick.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronPackagesService } from './positronPackagesService.js';
import { ILanguageRuntimePackage } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';

export const POSITRON_PACKAGES_VIEW_CONTAINER_ID = 'workbench.viewContainer.positronPackages';
export const POSITRON_PACKAGES_VIEW_ID = 'workbench.view.positronPackages.view';

const POSITRON_PACKAGES_ENABLED = ContextKeyExpr.equals('config.positron.environments.enable', true);

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
			when: POSITRON_PACKAGES_ENABLED
		}
	],
	viewContainer
);

export const PACKAGES_INSTALL_COMMAND_ID = 'positronPackages.installPackage';
export const PACKAGES_UPDATE_COMMAND_ID = 'positronPackages.updatePackage';
export const PACKAGES_UPDATE_ALL_COMMAND_ID = 'positronPackages.updateAllPackages';
export const PACKAGES_UNINSTALL_COMMAND_ID = 'positronPackages.uninstallPackage';
export const PACKAGES_REFRESH_COMMAND_ID = 'positronPackages.refreshPackages';

const PACKAGES_CATEGORY = nls.localize2('packages', 'Packages');

class RefreshPackagesAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_REFRESH_COMMAND_ID,
			title: nls.localize2('refreshPackages', 'Refresh Packages'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<ILanguageRuntimePackage[]> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		const cts = new CancellationTokenSource();

		return progress.withProgress({
			title: nls.localize('positronPackages.refreshingPackages', 'Refreshing Packages...'),
			location: ProgressLocation.Notification,
			cancellable: true,
			delay: 500
		}, async () => {
			try {
				return await service.refreshPackages(cts.token);
			} catch (error) {
				notifications.error(error);
				throw error;
			} finally {
				cts.dispose(true);
			}
		}, () => cts.cancel());
	}
}


class InstallPackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_INSTALL_COMMAND_ID,
			title: nls.localize2('installPackage', 'Install Package'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		// Create a token source for the entire install flow (search + install)
		const cts = new CancellationTokenSource();

		try {
			const performSearch = async (q: string) => {
				return await service.searchPackages(q, cts.token);
			};

			const performSearchVersions = async (pkg: string) => {
				return await service.searchPackageVersions(pkg, cts.token);
			};

			const performInstall = async (pkg: string, version?: string): Promise<void> => {
				if (!version) {
					throw new Error('No version specified.');
				}

				await progress.withProgress({
					title: nls.localize('positronPackages.installingPackages', 'Installing Packages...'),
					location: ProgressLocation.Notification,
					cancellable: true,
					delay: 500
				}, async () => {
					try {
						await service.installPackages([{ name: pkg, version }], cts.token);
					} catch (e) {
						notifications.error(e);
					} finally {
						cts.dispose(true);
					}
				}, () => cts.dispose(true));
			};

			await installPackage(accessor, performSearch, performSearchVersions, performInstall, cts);
		} catch (error) {
			notifications.error(error);
			throw error;
		} finally {
			cts.dispose(true);
		}
	}
}

class UninstallPackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_UNINSTALL_COMMAND_ID,
			title: nls.localize2('uninstallPackage', 'Uninstall Package'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const dialogService = accessor.get<IDialogService>(IDialogService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		const cts = new CancellationTokenSource();

		try {
			const performSearch = async () => {
				const packages = await service.refreshPackages(cts.token);
				return packages
					.map((x) => ({
						name: x.displayName
					}));
			};

			const performUninstall = async (pkg: string): Promise<void> => {
				await progress.withProgress({
					title: nls.localize('positronPackages.uninstallingPackages', 'Uninstalling Packages...'),
					location: ProgressLocation.Notification,
					cancellable: true,
					delay: 500
				}, async () => {
					try {
						await service.uninstallPackages([pkg], cts.token);
					} catch (e) {
						notifications.error(e);
					}
				}, () => cts.dispose(true));
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
				await uninstallPackage(accessor, performSearch, performUninstall, cts);
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
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
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

		// Create a token source for the entire update flow
		const cts = new CancellationTokenSource();

		try {
			const performSearch = async () => {
				const packages = await service.refreshPackages(cts.token);
				return packages
					.map((x) => ({
						name: x.displayName
					}));
			};

			const performSearchVersions = async (pkg: string) => {
				return service.searchPackageVersions(pkg, cts.token);
			};

			const performUpdate = async (pkg: string, version: string): Promise<void> => {
				await progress.withProgress({
					title: nls.localize('positronPackages.updatingPackages', 'Updating Packages...'),
					location: ProgressLocation.Notification,
					cancellable: true,
					delay: 500
				}, async () => {
					try {
						await service.updatePackages([{ name: pkg, version }], cts.token);
					} catch (e) {
						notifications.error(e);
					}
				}, () => cts.dispose(true));
			};

			const arg0 = args.at(0) as string | undefined;
			await updatePackage(accessor, performSearch, performSearchVersions, performUpdate, arg0, cts);
		} catch (error) {
			notifications.error(error);
			throw error;
		} finally {
			cts.dispose(true);
		}
	}
}

class UpdateAllPackagesAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_UPDATE_ALL_COMMAND_ID,
			title: nls.localize2('updateAllPackages', 'Update All Packages'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
			menu: {
				id: MenuId.ViewItemContext,
				when: ContextKeyExpr.equals('view', POSITRON_PACKAGES_VIEW_ID),
				group: 'navigation',
				order: 1
			}
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		const cts = new CancellationTokenSource();

		await progress.withProgress({
			title: nls.localize('positronPackages.updatingPackages', 'Updating Packages...'),
			location: ProgressLocation.Notification,
			cancellable: true,
			delay: 500
		}, async () => {
			try {
				await service.updateAllPackages(cts.token);
			} catch (e) {
				notifications.error(e);
				throw e;
			}
		}, () => cts.dispose(true));
	}
}

registerAction2(InstallPackageAction);
registerAction2(RefreshPackagesAction);
registerAction2(UninstallPackageAction);
registerAction2(UpdatePackageAction);
registerAction2(UpdateAllPackagesAction);
registerSingleton(IPositronPackagesService, PositronPackagesService, InstantiationType.Delayed);
