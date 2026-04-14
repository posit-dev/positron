/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import * as nls from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { ILanguageRuntimePackage, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { positronSessionViewIcon } from '../../positronSession/browser/positronSessionContainer.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { PACKAGES_CAN_RUN_ACTION, PACKAGES_HAS_SELECTION, PACKAGES_VIEW_VISIBLE, POSITRON_PACKAGES_VIEW_ID } from './positronPackagesContextKeys.js';
import { installPackage, uninstallPackage, updatePackage } from './positronPackagesQuickPick.js';
import { PositronPackagesService } from './positronPackagesService.js';
import { PositronPackagesView } from './positronPackagesView.js';

export const POSITRON_PACKAGES_VIEW_CONTAINER_ID = 'workbench.viewContainer.positronPackages';

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

/**
 * Extracts the error message and strips ANSI escape codes for clean display.
 */
function cleanErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return removeAnsiEscapeCodes(message);
}

/**
 * Shows a notification suggesting the user restart their session after a package operation.
 *
 * @param notifications The notification service
 * @param runtimeSessionService The runtime session service
 * @param commandService The command service
 * @param packagesService The packages service
 * @param operation The operation that was performed (e.g., 'installed', 'uninstalled', 'updated')
 * @param packageNames The names of the packages that were operated on
 */
function showRestartSessionNotification(
	notifications: INotificationService,
	runtimeSessionService: IRuntimeSessionService,
	commandService: ICommandService,
	packagesService: IPositronPackagesService,
	operation: string,
	packageNames: string[]
): void {
	const session = packagesService.activeSession;
	if (!session) {
		return;
	}

	const packageList = packageNames.length === 1
		? `"${packageNames[0]}"`
		: (() => {
			const visiblePackages = packageNames.slice(0, 3).map(name => `"${name}"`);
			if (packageNames.length > 3) {
				const remainingCount = packageNames.length - 3;
				visiblePackages.push(nls.localize('positronPackages.morePackages', "and {0} more", remainingCount));
			}
			return visiblePackages.join(', ');
		})();

	const message = packageNames.length === 1
		? nls.localize(
			'positronPackages.restartSessionSingular',
			'Package {0} was {1}. A session restart may be required for changes to take effect.',
			packageList,
			operation
		)
		: nls.localize(
			'positronPackages.restartSessionPlural',
			'Packages {0} were {1}. A session restart may be required for changes to take effect.',
			packageList,
			operation
		);

	notifications.prompt(
		Severity.Info,
		message,
		[{
			label: nls.localize('positronPackages.restartSession', 'Restart Session'),
			run: async () => {
				await commandService.executeCommand('workbench.action.positronConsole.focusConsole');
				await runtimeSessionService.restartSession(session.sessionId, 'Packages: Restart after package operation');
			}
		}]
	);
}

/**
 * Shows a notification suggesting the user restart their session after updating all packages.
 */
function showRestartSessionNotificationForUpdateAll(
	notifications: INotificationService,
	runtimeSessionService: IRuntimeSessionService,
	commandService: ICommandService,
	packagesService: IPositronPackagesService
): void {
	const session = packagesService.activeSession;
	if (!session) {
		return;
	}

	const message = nls.localize(
		'positronPackages.restartSessionUpdateAll',
		'Packages were updated. A session restart may be required for changes to take effect.'
	);

	notifications.prompt(
		Severity.Info,
		message,
		[{
			label: nls.localize('positronPackages.restartSession', 'Restart Session'),
			run: async () => {
				await commandService.executeCommand('workbench.action.positronConsole.focusConsole');
				await runtimeSessionService.restartSession(session.sessionId, 'Packages: Restart after package operation');
			}
		}]
	);
}
class RefreshPackagesAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_REFRESH_COMMAND_ID,
			title: nls.localize2('refreshPackages', 'Refresh Packages'),
			category: PACKAGES_CATEGORY,
			f1: true,
			icon: Codicon.refresh,
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION),
			menu: {
				id: MenuId.ViewTitle,
				when: PACKAGES_VIEW_VISIBLE,
				group: 'navigation',
				order: 1
			}
		});
	}
	override async run(accessor: ServicesAccessor): Promise<ILanguageRuntimePackage[]> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);

		const cts = new CancellationTokenSource();

		try {
			return await progress.withProgress({
				title: nls.localize('positronPackages.refreshingPackages', 'Refreshing Packages...'),
				location: ProgressLocation.Notification,
				cancellable: true,
				delay: 500
			}, async () => {
				try {
					return await service.refreshPackages(cts.token);
				} catch (error) {
					notifications.error(cleanErrorMessage(error));
					throw error;
				}
			}, () => cts.cancel());
		} finally {
			cts.dispose(true);
		}
	}
}


class InstallPackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_INSTALL_COMMAND_ID,
			title: nls.localize2('installPackage', 'Install Package'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION),
			menu: {
				id: MenuId.ViewTitle,
				when: PACKAGES_VIEW_VISIBLE,
				group: 'packages',
				order: 1
			}
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		const runtimeSessionService = accessor.get<IRuntimeSessionService>(IRuntimeSessionService);
		const commandService = accessor.get<ICommandService>(ICommandService);

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
						showRestartSessionNotification(
							notifications,
							runtimeSessionService,
							commandService,
							service,
							nls.localize('positronPackages.operationInstalled', 'installed'),
							[pkg]
						);
					} catch (e) {
						notifications.error(cleanErrorMessage(e));
					}
				}, () => cts.cancel());
			};

			await installPackage(accessor, performSearch, performSearchVersions, performInstall, cts);
		} catch (error) {
			notifications.error(cleanErrorMessage(error));
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
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION),
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const dialogService = accessor.get<IDialogService>(IDialogService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		const runtimeSessionService = accessor.get<IRuntimeSessionService>(IRuntimeSessionService);
		const commandService = accessor.get<ICommandService>(ICommandService);
		const cts = new CancellationTokenSource();

		try {
			const performSearch = async () => {
				const packages = await service.refreshPackages(cts.token);
				return packages
					.map((x) => ({
						name: x.name
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
						showRestartSessionNotification(
							notifications,
							runtimeSessionService,
							commandService,
							service,
							nls.localize('positronPackages.operationUninstalled', 'uninstalled'),
							[pkg]
						);
					} catch (e) {
						notifications.error(cleanErrorMessage(e));
					}
				}, () => cts.cancel());
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
			notifications.error(cleanErrorMessage(error));
			throw error;
		} finally {
			cts.dispose(true);
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
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION),
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		const runtimeSessionService = accessor.get<IRuntimeSessionService>(IRuntimeSessionService);
		const commandService = accessor.get<ICommandService>(ICommandService);

		// Create a token source for the entire update flow
		const cts = new CancellationTokenSource();

		try {
			const performSearch = async () => {
				const packages = await service.refreshPackages(cts.token);
				return packages
					.map((x) => ({
						name: x.name
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
						showRestartSessionNotification(
							notifications,
							runtimeSessionService,
							commandService,
							service,
							nls.localize('positronPackages.operationUpdated', 'updated'),
							[pkg]
						);
					} catch (e) {
						notifications.error(cleanErrorMessage(e));
					}
				}, () => cts.cancel());
			};

			const arg0 = args.at(0) as string | undefined;
			await updatePackage(accessor, performSearch, performSearchVersions, performUpdate, arg0, cts);
		} catch (error) {
			notifications.error(cleanErrorMessage(error));
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
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION),
			menu: {
				id: MenuId.ViewTitle,
				when: PACKAGES_VIEW_VISIBLE,
				group: 'packages',
				order: 2
			}
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		const runtimeSessionService = accessor.get<IRuntimeSessionService>(IRuntimeSessionService);
		const commandService = accessor.get<ICommandService>(ICommandService);

		const cts = new CancellationTokenSource();

		try {
			await progress.withProgress({
				title: nls.localize('positronPackages.updatingPackages', 'Updating Packages...'),
				location: ProgressLocation.Notification,
				cancellable: true,
				delay: 500
			}, async () => {
				try {
					await service.updateAllPackages(cts.token);
					showRestartSessionNotificationForUpdateAll(
						notifications,
						runtimeSessionService,
						commandService,
						service
					);
				} catch (e) {
					notifications.error(cleanErrorMessage(e));
					throw e;
				}
			}, () => cts.cancel());
		} finally {
			cts.dispose(true);
		}
	}
}

/**
 * Menu wrapper for Update Package that passes the selected package to the main command.
 */
class UpdateSelectedPackageAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.updateSelectedPackage',
			title: nls.localize2('updatePackage', 'Update Package'),
			category: PACKAGES_CATEGORY,
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION, PACKAGES_HAS_SELECTION),
			menu: {
				id: MenuId.ViewTitle,
				when: PACKAGES_VIEW_VISIBLE,
				group: 'packages',
				order: 3
			}
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IPositronPackagesService);
		const commandService = accessor.get(ICommandService);
		if (service.selectedPackage) {
			await commandService.executeCommand(PACKAGES_UPDATE_COMMAND_ID, service.selectedPackage);
		}
	}
}

/**
 * Menu wrapper for Uninstall Package that passes the selected package to the main command.
 */
class UninstallSelectedPackageAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.uninstallSelectedPackage',
			title: nls.localize2('uninstallPackage', 'Uninstall Package'),
			category: PACKAGES_CATEGORY,
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION, PACKAGES_HAS_SELECTION),
			menu: {
				id: MenuId.ViewTitle,
				when: PACKAGES_VIEW_VISIBLE,
				group: 'packages',
				order: 4
			}
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IPositronPackagesService);
		const commandService = accessor.get(ICommandService);
		if (service.selectedPackage) {
			await commandService.executeCommand(PACKAGES_UNINSTALL_COMMAND_ID, service.selectedPackage);
		}
	}
}

registerAction2(InstallPackageAction);
registerAction2(RefreshPackagesAction);
registerAction2(UninstallPackageAction);
registerAction2(UpdatePackageAction);
registerAction2(UpdateAllPackagesAction);
registerAction2(UpdateSelectedPackageAction);
registerAction2(UninstallSelectedPackageAction);
registerSingleton(IPositronPackagesService, PositronPackagesService, InstantiationType.Delayed);
