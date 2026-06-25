/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './missingPackagesBadge.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { IAction, toAction } from '../../../../base/common/actions.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IMissingPackagesResult, IMissingPackagesService } from '../common/missingPackagesService.js';

/** Setting that gates the editor/notebook badge. */
export const WARN_MISSING_IN_EDITOR = 'packages.warnMissingInEditor';

export interface MissingPackagesBadgeProps {
	/** The resource whose missing packages this badge reflects. */
	readonly resource: URI | undefined;
	readonly missingPackagesService: IMissingPackagesService;
	readonly configurationService: IConfigurationService;
}

/**
 * A shared badge for the editor action bar and the Positron notebook toolbar
 * that warns when the current document references packages that are not
 * installed, and offers to install them.
 *
 * Renders nothing until data arrives and never blocks render: it subscribes to
 * the missing-packages service and computes asynchronously.
 */
export const MissingPackagesBadge = (props: MissingPackagesBadgeProps) => {
	const { resource, missingPackagesService, configurationService } = props;

	const [result, setResult] = useState<IMissingPackagesResult | undefined>(() =>
		resource ? missingPackagesService.getCached(resource) : undefined);
	const [warnEnabled, setWarnEnabled] = useState<boolean>(() =>
		configurationService.getValue<boolean>(WARN_MISSING_IN_EDITOR) ?? true);

	// Compute (async) for the active resource and refresh when it changes.
	useEffect(() => {
		if (!resource) {
			setResult(undefined);
			return;
		}

		const disposables = new DisposableStore();
		let disposed = false;

		setResult(missingPackagesService.getCached(resource));
		missingPackagesService.ensure(resource).then(r => {
			if (!disposed) {
				setResult(r);
			}
		}, () => { /* never blocks the badge */ });

		disposables.add(missingPackagesService.onDidChangeMissingPackages(uri => {
			if (uri.toString() === resource.toString()) {
				missingPackagesService.ensure(resource).then(r => {
					if (!disposed) {
						setResult(r);
					}
				}, () => { });
			}
		}));

		return () => {
			disposed = true;
			disposables.dispose();
		};
	}, [resource, missingPackagesService]);

	// Track the warn-in-editor setting.
	useEffect(() => {
		const disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(WARN_MISSING_IN_EDITOR)) {
				setWarnEnabled(configurationService.getValue<boolean>(WARN_MISSING_IN_EDITOR) ?? true);
			}
		});
		return () => disposable.dispose();
	}, [configurationService]);

	// Render nothing when disabled or there is nothing to warn about.
	if (!warnEnabled || !result || result.total === 0) {
		return null;
	}

	const label = localize('positron.missingPackages.badge', "{0} missing packages", result.total);

	return (
		<ActionBarMenuButton
			actions={() => buildBadgeActions(result, missingPackagesService, configurationService)}
			align='right'
			ariaLabel={label}
			icon={{ id: 'warning' }}
			label={label}
			tooltip={label}
		>
			<div className='missing-packages-badge' data-testid='missing-packages-badge'>
				<span className='codicon codicon-warning'></span>
				<span className='missing-packages-label'>{label}</span>
			</div>
		</ActionBarMenuButton>
	);
};

/**
 * Builds the dropdown actions for the badge: an install action, the list of
 * missing package names (as disabled items), and a checked toggle for the
 * warn-in-editor setting.
 */
export function buildBadgeActions(
	result: IMissingPackagesResult,
	missingPackagesService: IMissingPackagesService,
	configurationService: IConfigurationService,
): IAction[] {
	const actions: IAction[] = [];

	actions.push(toAction({
		id: 'positron.missingPackages.install',
		label: localize('positron.missingPackages.installCount', "Install {0} packages", result.total),
		run: async () => {
			for (const group of result.groups) {
				await missingPackagesService.install(group);
			}
		},
	}));

	for (const group of result.groups) {
		for (const pkg of group.packages) {
			actions.push(toAction({
				id: `positron.missingPackages.item.${pkg.name}`,
				label: pkg.referencedName && pkg.referencedName !== pkg.name
					? localize('positron.missingPackages.itemAlias', "{0} (for {1})", pkg.name, pkg.referencedName)
					: pkg.name,
				enabled: false,
				run: async () => { },
			}));
		}
	}

	actions.push(toAction({
		id: 'positron.missingPackages.toggleWarn',
		label: localize('positron.missingPackages.toggleWarn', "Warn when packages are missing"),
		checked: true,
		run: async () => {
			await configurationService.updateValue(WARN_MISSING_IN_EDITOR, false, ConfigurationTarget.USER);
		},
	}));

	return actions;
}
