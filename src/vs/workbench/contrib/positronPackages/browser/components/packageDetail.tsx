/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './packageDetail.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../positronPackagesInstance.js';
import { derivePackageViewState, PackageAction } from '../packageViewState.js';
import { showPackageHelp } from '../packageHelp.js';

export interface PackageDetailProps {
	readonly languageId: string;
	readonly sessionId: string;
	readonly packageName: string;
	readonly packagesService: IPositronPackagesService;
}

/**
 * A single label/value row in the Overview list. Renders nothing when value is empty.
 */
const Field = (props: { label: string; value: string | undefined; children?: React.ReactNode }) => {
	if (!props.value && !props.children) {
		return null;
	}
	return (
		<>
			<div className='package-detail-field-label'>{props.label}</div>
			<div className='package-detail-field-value'>{props.children ?? props.value}</div>
		</>
	);
};

/**
 * PackageDetail component.
 * Renders the detail view for a package: header with actions, optional banners,
 * and an Overview metadata list.
 */
export const PackageDetail = (props: PackageDetailProps) => {
	const services = usePositronReactServicesContext();
	const { packagesService, sessionId, packageName } = props;

	// Bump on any relevant service/instance event to recompute from the service.
	const [, setTick] = useState(0);
	useEffect(() => {
		const store = new DisposableStore();
		const bump = () => setTick(t => t + 1);

		const instanceStore = store.add(new DisposableStore());
		const wireInstance = () => {
			instanceStore.clear();
			const instance = packagesService.getInstances()
				.find(i => i.session.metadata.sessionId === sessionId);
			if (instance) {
				instanceStore.add(instance.onDidRefreshPackagesInstance(bump));
			}
			bump();
		};

		store.add(packagesService.onDidChangeActivePackagesInstance(() => { wireInstance(); }));
		store.add(packagesService.onDidStopPackagesInstance(() => { wireInstance(); }));
		wireInstance();

		return () => store.dispose();
	}, [packagesService, sessionId]);

	const instance: IPositronPackagesInstance | undefined = packagesService.getInstances()
		.find(i => i.session.metadata.sessionId === sessionId);
	const sessionAlive = !!instance;
	const isActive = packagesService.activePackagesInstance?.session.metadata.sessionId === sessionId;
	const livePkg = instance?.packages.find(p => p.name.toLowerCase() === packageName.toLowerCase());

	// Retain the last-known package so the header/website survive uninstall/session-end.
	// A ref updated during render (always the same value within a render) avoids the
	// extra render cycles a state+effect would cause, since `instance.packages` returns
	// freshly-constructed objects on every read.
	const lastKnownRef = useRef<ILanguageRuntimePackage | undefined>(livePkg);
	if (livePkg) { lastKnownRef.current = livePkg; }
	const pkg = livePkg ?? lastKnownRef.current;

	const view = derivePackageViewState(pkg, { installed: !!livePkg, sessionAlive, isActive });

	const interpreter = instance?.session.runtimeMetadata.runtimeName ?? props.languageId.toUpperCase();
	const languageBadge = props.languageId === 'r' ? 'R' : props.languageId === 'python' ? 'Py' : props.languageId.slice(0, 2);

	const runAction = (action: PackageAction) => {
		switch (action) {
			case 'update':
				// Pass the target version so the update runs directly without
				// prompting for a version in a quick-pick.
				services.commandService.executeCommand('positronPackages.updatePackage', packageName, pkg?.latestVersion);
				break;
			case 'uninstall':
				services.commandService.executeCommand('positronPackages.uninstallPackage', packageName);
				break;
			case 'install':
				services.commandService.executeCommand('positronPackages.installPackage', packageName);
				break;
			case 'help':
				if (instance) {
					void showPackageHelp(instance.session, services.positronHelpService, services.notificationService, packageName);
				}
				break;
			case 'website':
				if (pkg?.url) {
					void services.openerService.open(URI.parse(pkg.url), { openExternal: true });
				}
				break;
		}
	};

	const actionLabel = (action: PackageAction): string => {
		switch (action) {
			case 'update':
				return localize('positron.packages.detail.update', "Update to {0}", pkg?.latestVersion ?? '');
			case 'uninstall':
				return localize('positron.packages.detail.uninstall', "Uninstall");
			case 'install':
				return localize('positron.packages.detail.install', "Install");
			case 'help':
				return localize('positron.packages.detail.help', "Show Help");
			case 'website':
				return localize('positron.packages.detail.action.website', "Website");
		}
	};

	// Update/Install use the prominent (primary) button colour; Uninstall is a
	// plain (secondary) button; Help and Website are icon-only buttons matching
	// the Packages list. Website is never disabled (opening a URL is not a
	// session operation).
	const renderActionButton = (action: PackageAction) => {
		const disabled = action !== 'website' && !view.actionsEnabled;
		switch (action) {
			case 'update':
			case 'install':
				return (
					<Button
						key={action}
						className='package-detail-action package-detail-action-primary'
						disabled={disabled}
						onPressed={() => runAction(action)}
					>
						{actionLabel(action)}
					</Button>
				);
			case 'uninstall':
				return (
					<Button
						key={action}
						className='package-detail-action'
						disabled={disabled}
						onPressed={() => runAction(action)}
					>
						{actionLabel(action)}
					</Button>
				);
			case 'help':
				return (
					<Button
						key={action}
						ariaLabel={actionLabel('help')}
						className='package-detail-action package-detail-action-icon'
						disabled={disabled}
						tooltip={actionLabel('help')}
						onPressed={() => runAction(action)}
					>
						<span className='codicon codicon-book' />
					</Button>
				);
			case 'website':
				return (
					<Button
						key={action}
						ariaLabel={actionLabel('website')}
						className='package-detail-action package-detail-action-icon'
						tooltip={actionLabel('website')}
						onPressed={() => runAction(action)}
					>
						<span className='codicon codicon-link-external' />
					</Button>
				);
		}
	};

	// Installed version, with "(latest)" appended when the runtime reports the
	// installed version is the latest (so we omit a separate Latest version row).
	const installedVersionText = livePkg
		? (livePkg.outdated === false
			? localize('positron.packages.detail.versionLatest', "{0} (latest)", livePkg.version)
			: livePkg.version)
		: undefined;

	return (
		<div className='positron-package-detail'>
			<div className='package-detail-header'>
				<div aria-hidden='true' className='package-detail-icon'>{languageBadge}</div>
				<div className='package-detail-header-main'>
					<div className='package-detail-title-row'>
						<h2 className='package-detail-title'>{packageName}</h2>
						{pkg?.version && <span className='package-detail-version'>{pkg.version}</span>}
						{pkg?.attached && <span className='package-detail-attached-pill'>{localize('positron.packages.detail.attached', "Attached")}</span>}
					</div>
					{pkg?.description && <div className='package-detail-description'>{pkg.description}</div>}
					<div className='package-detail-actions'>
						{view.actions.map(renderActionButton)}
					</div>
				</div>
			</div>

			{view.showNotActiveHint &&
				<div className='package-detail-banner'>
					{localize('positron.packages.detail.notActive', "Viewing {0} - not the active session", interpreter)}
				</div>
			}

			{view.installState === 'session-ended' &&
				<div className='package-detail-banner'>
					{localize('positron.packages.detail.sessionEnded', "This session has ended. Reopen the package after starting a new session.")}
				</div>
			}

			<div className='package-detail-tabs'>
				<div className='package-detail-tab active'>{localize('positron.packages.detail.overview', "Overview")}</div>
			</div>

			<div className='package-detail-overview'>
				<Field label={localize('positron.packages.detail.installedVersion', "Installed version")} value={installedVersionText} />
				<Field label={localize('positron.packages.detail.latestVersion', "Latest version")} value={pkg?.outdated ? pkg?.latestVersion : undefined} />
				<Field label={localize('positron.packages.detail.license', "License")} value={pkg?.license} />
				<Field label={localize('positron.packages.detail.published', "Date published")} value={pkg?.publishedDate} />
				<Field label={localize('positron.packages.detail.interpreter', "Interpreter")} value={interpreter} />
			</div>
		</div>
	);
};
