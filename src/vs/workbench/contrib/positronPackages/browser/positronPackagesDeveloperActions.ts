/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { POSITRON_PACKAGES_ENABLED } from './positronPackagesContextKeys.js';

/**
 * Command Palette entry that drops the cached package metadata -- outdated
 * state and security advisories -- for every running interpreter session.
 *
 * Exists because nothing else can put the pane, or the getPackages payload,
 * back into its cold-start state. The cache is persisted, seeded at session
 * start, and refilled by the refresh that runs within seconds of a session
 * becoming ready, so the states that only exist before any fetch has landed --
 * no update indicators, and a payload reporting vulnerabilityStatus 'cached'
 * with no vulnerabilitySource -- are otherwise unreachable by hand. That last
 * one is what makes "Show Packages as JSON" offer its advisory lookup, so
 * without this there is no way to exercise that path against a real Package
 * Manager.
 *
 * Filed under Developer because clearing a cache is a diagnostic act: it costs
 * the next refresh the network round trip the cache exists to avoid, and no user
 * flow needs it.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class ClearPackageMetadataCacheAction extends Action2 {
	constructor() {
		super({
			id: 'positronPackages.clearMetadataCache',
			title: localize2('positron.packages.clearMetadataCache', 'Clear Package Metadata Cache'),
			category: Categories.Developer,
			f1: true,
			precondition: POSITRON_PACKAGES_ENABLED,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const packagesService = accessor.get(IPositronPackagesService);
		const notificationService = accessor.get(INotificationService);

		// Per running session rather than the whole persisted blob: an instance
		// owns both halves of its own state (the in-memory map and the on-disk
		// entry keyed by its runtimeId), and clearing only the disk half would
		// leave the pane rendering from memory as though nothing had happened.
		// Entries for interpreters with no live session are left alone -- they
		// aren't what a test is looking at, and reaching them would mean a
		// clear-all no other caller wants.
		const instances = packagesService.getInstances();
		for (const instance of instances) {
			instance.clearMetadata();
		}

		// Clearing a cache leaves nothing on screen to confirm it happened
		// beyond indicators quietly disappearing, which is easy to miss and
		// easy to mistake for the command not having run.
		notificationService.info(instances.length === 0
			? localize(
				'positron.packages.clearMetadataCache.noSessions',
				"No interpreter sessions are running, so there was no cached package metadata to clear."
			)
			: localize(
				'positron.packages.clearMetadataCache.cleared',
				"Cleared cached package metadata for {0} interpreter session(s). The next refresh will fetch it again.",
				instances.length
			));
	}
}

registerAction2(ClearPackageMetadataCacheAction);
