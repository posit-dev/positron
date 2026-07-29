/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellation } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { basename } from '../../../../base/common/resources.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../positronNotebook/common/positronNotebookCommon.js';
import { IMissingPackagesResult, IMissingPackagesService } from '../common/missingPackagesService.js';
import { installPackagesLabel, installingMessage } from './missingPackagesBadge.js';
import { showMissingPackagesInstallModal } from './missingPackagesInstallModal.js';
import { MISSING_PACKAGES_SUPPORTED_KEY } from './missingPackagesContextKey.js';

/** Command category, matching the Packages pane commands. */
const PACKAGES_CATEGORY = localize2('packages', 'Packages');

export const CHECK_MISSING_PACKAGES_COMMAND_ID = 'positron.missingPackages.check';
export const INSTALL_MISSING_PACKAGES_COMMAND_ID = 'positron.missingPackages.install';

/**
 * The editors these commands apply to: whatever the capability context key
 * covers, plus Positron notebooks. Matches where the editor/notebook badge
 * appears.
 */
const MISSING_PACKAGES_SUPPORTED = ContextKeyExpr.or(
	MISSING_PACKAGES_SUPPORTED_KEY,
	ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
);

/**
 * The services the commands need, gathered synchronously from the accessor so
 * they remain valid across the awaits in the command flow.
 */
interface MissingPackagesCommandServices {
	readonly editorService: IEditorService;
	readonly missingPackagesService: IMissingPackagesService;
	readonly progressService: IProgressService;
	readonly notificationService: INotificationService;
	readonly languageService: ILanguageService;
}

function gatherServices(accessor: ServicesAccessor): MissingPackagesCommandServices {
	return {
		editorService: accessor.get(IEditorService),
		missingPackagesService: accessor.get(IMissingPackagesService),
		progressService: accessor.get(IProgressService),
		notificationService: accessor.get(INotificationService),
		languageService: accessor.get(ILanguageService),
	};
}

/**
 * Resolves the active editor's resource and analyzes it for missing packages,
 * blocking on the computation (unlike the ambient surfaces) but reusing the cache
 * when it is already warm. A progress notification appears only if the check runs
 * longer than a second, so a cache hit is silent.
 *
 * @returns The result, or undefined when there is no active editor to analyze.
 */
async function computeMissingPackages(services: MissingPackagesCommandServices): Promise<IMissingPackagesResult | undefined> {
	const { editorService, missingPackagesService, progressService, notificationService } = services;

	const resource = editorService.activeEditor?.resource;
	if (!resource) {
		notificationService.info(localize(
			'positron.missingPackages.noActiveEditor',
			"Open a script or notebook to check for missing packages."));
		return undefined;
	}

	// Make the check cancellable so the user can stop waiting if a session is slow
	// to respond (e.g. a runtime that is still starting). The underlying analysis
	// is shared across callers and is not itself cancelled; we just stop awaiting
	// it and dismiss the progress.
	const cts = new CancellationTokenSource();
	try {
		return await progressService.withProgress({
			location: ProgressLocation.Notification,
			title: localize('positron.missingPackages.checking', "Checking {0} for missing packages", basename(resource)),
			// Only surface the toast when the check is slow (no warm cache).
			delay: 1000,
			cancellable: true,
		}, () => raceCancellation(missingPackagesService.ensure(resource, cts.token), cts.token),
			() => cts.cancel());
	} finally {
		cts.dispose(true);
	}
}

/**
 * Installs the missing packages in a result, wrapped in a progress notification.
 * Surfaces success and failure as notifications.
 */
async function installMissingPackages(services: MissingPackagesCommandServices, result: IMissingPackagesResult): Promise<void> {
	const { missingPackagesService, progressService, notificationService } = services;

	try {
		await progressService.withProgress({
			location: ProgressLocation.Notification,
			title: installingMessage(result),
		}, () => missingPackagesService.installAll(result));
		notificationService.info(localize(
			'positron.missingPackages.installed',
			"Installed missing packages for {0}.", basename(result.resource)));
	} catch (err) {
		notificationService.warn(localize(
			'positron.missingPackages.commandInstallFailed',
			"Failed to install missing packages: {0}", String(err)));
	}
}

/**
 * Reports that the analyzed document has all of its referenced packages
 * installed.
 */
function notifyAllInstalled(services: MissingPackagesCommandServices, result: IMissingPackagesResult): void {
	services.notificationService.info(localize(
		'positron.missingPackages.allInstalled',
		"All packages required by {0} are installed.", basename(result.resource)));
}

/**
 * "Check for Missing Packages": analyzes the active document, and if any
 * referenced packages are not installed, offers to install them via a modal.
 * Reports when nothing is missing.
 */
export class CheckMissingPackagesAction extends Action2 {
	constructor() {
		super({
			id: CHECK_MISSING_PACKAGES_COMMAND_ID,
			title: localize2('positron.missingPackages.checkCommand', 'Check for Missing Packages'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: MISSING_PACKAGES_SUPPORTED,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const services = gatherServices(accessor);

		const result = await computeMissingPackages(services);
		if (!result) {
			return;
		}
		if (result.total === 0) {
			notifyAllInstalled(services, result);
			return;
		}

		// Offer to install via a modal that names the missing packages.
		const packageNames = result.groups.flatMap(group => group.packages.map(pkg => pkg.name));
		const languageIds = [...new Set(result.groups.map(group => group.languageId))];
		const languageName = languageIds.length === 1
			? services.languageService.getLanguageName(languageIds[0])
			: null;

		const confirmed = await showMissingPackagesInstallModal(
			basename(result.resource), languageName, packageNames, installPackagesLabel(result));
		if (!confirmed) {
			return;
		}

		await installMissingPackages(services, result);
	}
}

/**
 * "Install Missing Packages": like {@link CheckMissingPackagesAction} but
 * installs immediately without prompting.
 */
export class InstallMissingPackagesAction extends Action2 {
	constructor() {
		super({
			id: INSTALL_MISSING_PACKAGES_COMMAND_ID,
			title: localize2('positron.missingPackages.installCommand', 'Install Missing Packages'),
			category: PACKAGES_CATEGORY,
			f1: true,
			precondition: MISSING_PACKAGES_SUPPORTED,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const services = gatherServices(accessor);

		const result = await computeMissingPackages(services);
		if (!result) {
			return;
		}
		if (result.total === 0) {
			notifyAllInstalled(services, result);
			return;
		}
		await installMissingPackages(services, result);
	}
}

/** Registers the missing-packages command-palette commands. */
export function registerMissingPackagesCommands(): void {
	registerAction2(CheckMissingPackagesAction);
	registerAction2(InstallMissingPackagesAction);
}
