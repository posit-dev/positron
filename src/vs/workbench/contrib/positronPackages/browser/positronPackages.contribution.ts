/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import * as nls from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { PackageEditor } from './packageEditor.js';
import { PackageEditorInput } from './packageEditorInput.js';
import { ILanguageRuntimePackage, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { positronSessionViewIcon } from '../../positronSession/browser/positronSessionContainer.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { PACKAGE_METADATA_CACHE_ENABLED_SETTING, PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT, PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING } from './packageMetadataCache.js';
import { PACKAGES_VULNERABILITIES_ENABLED_SETTING } from './packageVulnerabilities.js';
import { PACKAGES_VULNERABILITIES_SOURCE_SETTING } from './packageVulnerabilityLookup.js';
import { PACKAGES_CAN_RUN_ACTION, PACKAGES_HAS_SELECTION, PACKAGES_VIEW_VISIBLE, POSITRON_PACKAGES_ITEM_SIZE, POSITRON_PACKAGES_VIEW_ID } from './positronPackagesContextKeys.js';
import { installPackage, uninstallPackage, updatePackage } from './positronPackagesQuickPick.js';
import { PositronPackagesService } from './positronPackagesService.js';
import { PositronPackagesView } from './positronPackagesView.js';

export const POSITRON_PACKAGES_VIEW_CONTAINER_ID = 'workbench.viewContainer.positronPackages';

const POSITRON_PACKAGES_ENABLED = ContextKeyExpr.and(
	ContextKeyExpr.equals('config.packages.enabled', true),
	ContextKeyExpr.equals('config.positron.packages.enable', true),
)!;

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
			when: POSITRON_PACKAGES_ENABLED,
			focusCommand: {
				id: `${POSITRON_PACKAGES_VIEW_ID}.focus`,
				agentCompatible: true,
			},
		}
	],
	viewContainer
);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'packages',
	order: 100,
	type: 'object',
	title: nls.localize('packagesConfigurationTitle', 'Packages'),
	properties: {
		'packages.enabled': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: nls.localize('positron.packages.enabled', 'Show the Packages pane.'),
			tags: ['preview'],
		},
		'positron.packages.enable': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: nls.localize('positron.packages.enable', 'Show the Packages pane.'),
			markdownDeprecationMessage: nls.localize('positron.packages.enable.deprecated', "Deprecated. Use `#packages.enabled#` instead."),
		},
		'packages.r.installer': {
			type: 'string',
			enum: ['auto', 'pak', 'base'],
			enumDescriptions: [
				nls.localize('positron.packages.r.installer.auto', "Use pak if installed; otherwise use base R and offer to install pak."),
				nls.localize('positron.packages.r.installer.pak', "Always use pak. Silently install it if missing."),
				nls.localize('positron.packages.r.installer.base', "Always use base R."),
			],
			default: 'auto',
			scope: ConfigurationScope.RESOURCE,
			markdownDescription: nls.localize('positron.packages.r.installer', "Which package installer to use for installing, updating, and removing R packages. Does not affect projects using renv, which always use renv."),
			tags: ['preview'],
		},
		'packages.r.renvAutoSnapshot': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			markdownDescription: nls.localize('positron.packages.r.renvAutoSnapshot', "When using renv, automatically run `renv::snapshot()` in the Console after installing, updating, or removing packages to keep `renv.lock` in sync. The snapshot runs independently, so its success or failure does not affect the package operation."),
			tags: ['preview'],
		},
		[PACKAGES_VULNERABILITIES_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			// Machine scope, not application: this governs which host the
			// machine talks to, so a server deployment must be able to set it
			// in its own settings and a workspace must not override it.
			scope: ConfigurationScope.MACHINE,
			markdownDescription: nls.localize('positron.packages.vulnerabilities.enabled', "Show known security vulnerabilities (CVEs) for installed packages. The lookup sends the names and versions of installed packages to a Posit Package Manager instance; `#packages.vulnerabilities.source#` controls which instances may be used."),
			tags: ['preview'],
		},
		[PACKAGES_VULNERABILITIES_SOURCE_SETTING]: {
			type: 'string',
			enum: ['auto', 'environment'],
			enumDescriptions: [
				nls.localize('positron.packages.vulnerabilities.source.auto', "Use the Package Manager the environment installs from. When the environment has no Package Manager repository configured, use Posit's public instance at packagemanager.posit.co."),
				nls.localize('positron.packages.vulnerabilities.source.environment', "Only use the Package Manager the environment installs from. Nothing is sent to any other host, so environments without a Package Manager repository show no advisories. Recommended for managed or network-restricted deployments."),
			],
			default: 'auto',
			scope: ConfigurationScope.MACHINE,
			markdownDescription: nls.localize('positron.packages.vulnerabilities.source', "Which Posit Package Manager instances may be asked about installed packages. An environment that installs from a Package Manager is only ever asked about its own instance; this setting controls what happens when no Package Manager repository is configured. Only applies when `#packages.vulnerabilities.enabled#` is enabled."),
			tags: ['preview'],
		},
		[PACKAGE_METADATA_CACHE_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: nls.localize('positron.packages.metadataCache.enabled', "Cache package metadata (such as update availability) on disk so it appears immediately on a new session, while the latest data is fetched in the background."),
			tags: ['preview'],
		},
		[PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING]: {
			type: 'number',
			default: PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT,
			minimum: 1,
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: nls.localize('positron.packages.metadataCache.maxAgeHours', "How long, in hours, cached package metadata is shown before it is refreshed in the background. Only applies when `#packages.metadataCache.enabled#` is enabled."),
			tags: ['preview'],
		},
		'packages.confirmMissingOnRun': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			description: nls.localize('positron.packages.confirmMissingOnRun', "Before running a file or notebook, offer to install packages it references that are not installed."),
			tags: ['preview'],
		},
		'packages.warnMissingInEditor': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			description: nls.localize('positron.packages.warnMissingInEditor', "Show a warning in the editor when the current file references packages that are not installed."),
			tags: ['preview'],
		},
		'packages.suggestInstallOnError': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.RESOURCE,
			description: nls.localize('positron.packages.suggestInstallOnError', "When a runtime error reports a missing package, suggest installing it beneath the error in the Console."),
			tags: ['preview'],
		}
	}
});

export const PACKAGES_INSTALL_COMMAND_ID = 'positronPackages.installPackage';
export const PACKAGES_OPEN_COMMAND_ID = 'positronPackages.openPackage';
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
 * The version an agent passes to ask for the newest version available to the
 * session. Human callers never pass it: the quick-picks and the package detail
 * editor either supply a concrete version or none at all.
 *
 * A missing version can't carry this meaning, because the UI already uses it:
 * the packages list's Update button passes a name and no version to get the
 * version quick-pick.
 */
const LATEST_VERSION = 'latest';

/**
 * Whether the caller asked for the newest version rather than a specific one.
 */
function isLatestRequest(version: string): boolean {
	return version.toLowerCase() === LATEST_VERSION;
}

/**
 * Outcome of turning `'latest'` into the version an update should target.
 */
type LatestVersionResolution =
	| { readonly ok: true; readonly version: string }
	| { readonly ok: false; readonly message: string };

/**
 * Asks the session which version of an installed package is the newest one
 * available to it.
 *
 * The session already computes this for the packages list's outdated indicator,
 * using its own version semantics, so nothing is compared here. The update still
 * receives an explicit version, because pip and uv reject an unversioned one.
 *
 * Failures come back as a message rather than an exception, so a programmatic
 * caller gets the same result shape it gets for a failed update.
 */
async function resolveLatestForUpdate(
	service: IPositronPackagesService,
	notifications: INotificationService,
	name: string,
	token: CancellationToken
): Promise<LatestVersionResolution> {
	let latest: string | undefined;
	try {
		latest = await service.resolveLatestVersion(name, token);
	} catch (e) {
		if (isCancellationError(e) || token.isCancellationRequested) {
			return {
				ok: false,
				message: nls.localize('positronPackages.versionLookupCanceled', "Finding the latest version of '{0}' was canceled.", name)
			};
		}
		const message = cleanErrorMessage(e);
		notifications.error(message);
		return { ok: false, message };
	}

	if (!latest) {
		// Not an error, and deliberately not notified as one: the usual reason is
		// that the installed version is already the newest available.
		return {
			ok: false,
			message: nls.localize('positronPackages.noNewerVersion', "No newer version of '{0}' is available to this session.", name)
		};
	}
	return { ok: true, version: latest };
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
			},
			metadata: {
				description: nls.localize('positronPackages.refreshPackages.description', "Refresh the list of installed packages in the active runtime session."),
				agentCompatible: true,
			},
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
					// User-initiated refresh: force a live outdated recompute so
					// the pane can't keep showing stale cached indicators.
					return await service.refreshPackages(cts.token, true /* forceMetadata */);
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


/**
 * Result of the installPackage command, returned to programmatic callers
 * (notably agents via `positron.ai.validateAndExecuteCommand`).
 */
interface IInstallPackageResult {
	installed: boolean;
	name?: string;
	version?: string;
	message?: string;
}

/**
 * Installs a package into the active session. Exported so its argument handling
 * and result can be unit-tested.
 */
export class InstallPackageAction extends Action2 {
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
			},
			metadata: {
				description: nls.localize('positronPackages.installPackage.description', "Install a package into the active runtime session's environment (R library, Python environment). Requires a running interpreter session. A session restart may be required before the newly installed package can be loaded."),
				agentCompatible: true,
				args: [
					{ name: 'name', description: 'Name of the package to install, as the package repository knows it (for example: dplyr, pandas).', schema: { type: 'string' } },
					{ name: 'version', description: 'Version to install: either an exact version (for example: 1.1.4) or \'latest\' for the newest version available to the session. If the package is already installed, installing it again does nothing, whatever this is set to -- use the update command to move an installed package to a different version. Base R installs ignore this and always install the current release from the repository.', schema: { type: 'string' } },
				],
				returns: 'An object with installed, name, version, and message. installed is true when the package was installed; version is then the version that was actually installed, read back from the session, which is how you learn which version \'latest\' turned out to be. When installed is false, message explains why (a failed install, or a canceled install).',
			},
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<IInstallPackageResult> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		const notifications = accessor.get<INotificationService>(INotificationService);
		const progress = accessor.get<IProgressService>(IProgressService);
		const runtimeSessionService = accessor.get<IRuntimeSessionService>(IRuntimeSessionService);
		const commandService = accessor.get<ICommandService>(ICommandService);

		// Create a token source for the entire install flow (search + install)
		const cts = new CancellationTokenSource();

		try {
			const performSearch = async (q: string, token: CancellationToken) => {
				return await service.searchPackages(q, token);
			};

			const performSearchVersions = async (pkg: string) => {
				return await service.searchPackageVersions(pkg, cts.token);
			};

			// Captured rather than returned, so the quick-pick helper's callback
			// signature stays unchanged.
			let outcome: IInstallPackageResult | undefined;

			const performInstall = async (pkg: string, version?: string): Promise<void> => {
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
						// With no version requested, the package manager chose one.
						// Read back what it actually installed rather than
						// predicting it: installPackages refreshes the list before
						// it resolves, so the version is already there.
						const installedVersion = version ?? service.activePackagesInstance?.packages
							.find((installed) => installed.name.toLowerCase() === pkg.toLowerCase())?.version;
						outcome = { installed: true, name: pkg, version: installedVersion };
					} catch (e) {
						if (isCancellationError(e) || cts.token.isCancellationRequested) {
							// The user canceled the progress notification; an error
							// toast would be wrong.
							outcome = {
								installed: false,
								name: pkg,
								version,
								message: nls.localize('positronPackages.installCanceled', "The install of '{0}' was canceled.", pkg)
							};
							return;
						}
						const message = cleanErrorMessage(e);
						notifications.error(message);
						outcome = { installed: false, name: pkg, version, message };
					}
				}, () => cts.cancel());
			};

			// When a package name and version are both provided (e.g. the detail
			// editor's Install button, or an agent), install that version
			// directly. Only a real string is treated as the package name --
			// menu invocations (e.g. the view-title overflow "Install Package")
			// pass a context object as arg0, which must fall through to the
			// search quick-pick, as must a name with no version.
			const argPackage = typeof args.at(0) === 'string' ? (args.at(0) as string).trim() || undefined : undefined;
			const argVersion = typeof args.at(1) === 'string' ? (args.at(1) as string).trim() || undefined : undefined;
			if (argPackage && argVersion) {
				// 'latest' becomes no version at all. Given a bare package name
				// every package manager installs the newest version the session
				// can see, so there is nothing here to resolve -- and nothing to
				// get wrong about which version that is.
				const targetVersion = isLatestRequest(argVersion) ? undefined : argVersion;
				await performInstall(argPackage, targetVersion);
				return outcome ?? { installed: false, name: argPackage, version: targetVersion };
			}

			await installPackage(accessor, performSearch, performSearchVersions, performInstall, cts);
			return outcome ?? {
				installed: false,
				message: nls.localize('positronPackages.noPackageSelected', "No package was selected.")
			};
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

/**
 * Result of the updatePackage command, returned to programmatic callers
 * (notably agents via `positron.ai.validateAndExecuteCommand`).
 */
interface IUpdatePackageResult {
	updated: boolean;
	name?: string;
	version?: string;
	message?: string;
}

/**
 * Updates an installed package in the active session. Exported so its argument
 * handling and result can be unit-tested.
 */
export class UpdatePackageAction extends Action2 {
	constructor() {
		super({
			id: PACKAGES_UPDATE_COMMAND_ID,
			title: nls.localize2('updatePackage', 'Update Package'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.and(POSITRON_PACKAGES_ENABLED, PACKAGES_CAN_RUN_ACTION),
			metadata: {
				description: nls.localize('positronPackages.updatePackage.description', "Update a package that is already installed in the active runtime session to a different version. Requires a running interpreter session. A session restart may be required before the new version is loaded."),
				agentCompatible: true,
				args: [
					{ name: 'name', description: 'Name of the installed package to update (for example: dplyr, pandas).', schema: { type: 'string' } },
					{ name: 'version', description: 'Version to update to: either an exact version (for example: 1.1.4) or \'latest\' for the newest version available to the session. Base R updates ignore this and always install the current release from the repository.', schema: { type: 'string' } },
				],
				returns: 'An object with updated, name, version, and message. updated is true when the package was updated, with name and version confirming what was requested (version is the concrete version the session reported as newest when \'latest\' was passed); when updated is false, message explains why (the installed version is already the newest available, a failed update, or a canceled update).',
			},
		});
	}
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<IUpdatePackageResult> {
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

			// Captured rather than returned, so the quick-pick helper's callback
			// signature stays unchanged.
			let outcome: IUpdatePackageResult | undefined;

			const performUpdate = async (pkg: string, version?: string): Promise<void> => {
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
						outcome = { updated: true, name: pkg, version };
					} catch (e) {
						if (isCancellationError(e) || cts.token.isCancellationRequested) {
							// The user canceled the progress notification; an error
							// toast would be wrong.
							outcome = {
								updated: false,
								name: pkg,
								version,
								message: nls.localize('positronPackages.updateCanceled', "The update of '{0}' was canceled.", pkg)
							};
							return;
						}
						const message = cleanErrorMessage(e);
						notifications.error(message);
						outcome = { updated: false, name: pkg, version, message };
					}
				}, () => cts.cancel());
			};

			// Only treat a real string as the package name (menu invocations pass a
			// context object as arg0). When both a package name and a target version
			// are given (e.g. the detail editor's Update button, or an agent),
			// update directly without prompting; otherwise fall through to the
			// quick-pick flow, which is how the packages list's Update button picks
			// a version.
			const argPackage = typeof args.at(0) === 'string' ? (args.at(0) as string).trim() || undefined : undefined;
			const argVersion = typeof args.at(1) === 'string' ? (args.at(1) as string).trim() || undefined : undefined;
			if (argPackage && argVersion) {
				let targetVersion = argVersion;
				if (isLatestRequest(argVersion)) {
					const latest = await resolveLatestForUpdate(service, notifications, argPackage, cts.token);
					if (!latest.ok) {
						return { updated: false, name: argPackage, message: latest.message };
					}
					targetVersion = latest.version;
				}
				await performUpdate(argPackage, targetVersion);
				return outcome ?? { updated: false, name: argPackage, version: targetVersion };
			}
			await updatePackage(accessor, performSearch, performSearchVersions, performUpdate, argPackage, cts);
			return outcome ?? {
				updated: false,
				name: argPackage,
				message: argPackage
					? nls.localize('positronPackages.noVersionSelected', "No version was selected.")
					: nls.localize('positronPackages.noPackageSelectedForUpdate', "No package was selected.")
			};
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
			},
			metadata: {
				description: nls.localize('positronPackages.updateAllPackages.description', "Update every installed package in the active runtime session to its latest available version."),
				agentCompatible: true,
			},
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
					const updated = await service.updateAllPackages(cts.token);
					if (cts.token.isCancellationRequested) {
						return;
					}
					if (updated.length === 0) {
						notifications.info(nls.localize('positronPackages.allUpToDate', 'All packages are already up to date.'));
					} else {
						showRestartSessionNotification(
							notifications,
							runtimeSessionService,
							commandService,
							service,
							nls.localize('positronPackages.operationUpdated', 'updated'),
							updated
						);
					}
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

/**
 * Switches the Packages view to the expanded card layout.
 * Only visible in the view title when the view is currently showing compact rows.
 */
class SetPackagesCardViewAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.setCardView',
			title: nls.localize2('positronPackages.showAsCards', 'Show as Cards'),
			category: PACKAGES_CATEGORY,
			icon: Codicon.listSelection,
			precondition: POSITRON_PACKAGES_ENABLED,
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.and(PACKAGES_VIEW_VISIBLE, POSITRON_PACKAGES_ITEM_SIZE.isEqualTo('row')),
				group: 'navigation',
				order: 2,
			},
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get<IPositronPackagesService>(IPositronPackagesService).setItemSize('card');
	}
}

/**
 * Switches the Packages view to the compact row layout.
 * Only visible in the view title when the view is currently showing cards.
 */
class SetPackagesRowViewAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.setRowView',
			title: nls.localize2('positronPackages.showAsRows', 'Show as Rows'),
			category: PACKAGES_CATEGORY,
			icon: Codicon.listFlat,
			precondition: POSITRON_PACKAGES_ENABLED,
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.and(PACKAGES_VIEW_VISIBLE, POSITRON_PACKAGES_ITEM_SIZE.isEqualTo('card')),
				group: 'navigation',
				order: 2,
			},
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get<IPositronPackagesService>(IPositronPackagesService).setItemSize('row');
	}
}

/**
 * Toggles between card and row layouts. Exposed via the command palette.
 */
class TogglePackagesItemSizeAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.toggleItemSize',
			title: nls.localize2('positronPackages.toggleItemSize', 'Toggle Packages List Layout'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get<IPositronPackagesService>(IPositronPackagesService);
		service.setItemSize(service.itemSize === 'card' ? 'row' : 'card');
	}
}

// Register the package detail editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PackageEditor,
		PackageEditor.ID,
		nls.localize('positron.packageDetailEditor', "Package Detail Editor")
	),
	[
		new SyncDescriptor(PackageEditorInput)
	]
);

// Opens a package detail editor for the given package name.
// `pinned` is false for preview (single-click) and true for a pinned tab (double-click).
CommandsRegistry.registerCommand(PACKAGES_OPEN_COMMAND_ID,
	async (accessor: ServicesAccessor, packageName: string, pinned: boolean) => {
		const packagesService = accessor.get(IPositronPackagesService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		const instance = packagesService.activePackagesInstance;
		if (!instance) {
			return;
		}
		const input = instantiationService.createInstance(PackageEditorInput, {
			languageId: instance.session.runtimeMetadata.languageId,
			sessionId: instance.session.sessionId,
			packageName,
		});
		await editorService.openEditor(input, { pinned });
	});

registerAction2(InstallPackageAction);
registerAction2(RefreshPackagesAction);
registerAction2(UninstallPackageAction);
registerAction2(UpdatePackageAction);
registerAction2(UpdateAllPackagesAction);
registerAction2(UpdateSelectedPackageAction);
registerAction2(UninstallSelectedPackageAction);
registerAction2(SetPackagesCardViewAction);
registerAction2(SetPackagesRowViewAction);
registerAction2(TogglePackagesItemSizeAction);
registerSingleton(IPositronPackagesService, PositronPackagesService, InstantiationType.Delayed);
