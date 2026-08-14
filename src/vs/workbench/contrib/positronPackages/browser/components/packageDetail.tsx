/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './packageDetail.css';
import '../packageVulnerabilities.css';

// React.
import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

// Other dependencies.
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronConfiguration } from '../../../../../base/browser/positronReactHooks.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILanguageRuntimePackage, IPackageVulnerability } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../positronPackagesInstance.js';
import { derivePackageViewState, PackageAction } from '../packageViewState.js';
import { showPackageHelp } from '../packageHelp.js';
import { maxVulnerabilityScore, PACKAGES_VULNERABILITIES_ENABLED_SETTING, severityBand, severityBandLabel } from '../packageVulnerabilities.js';

export interface PackageDetailProps {
	readonly languageId: string;
	readonly sessionId: string;
	readonly packageName: string;
	readonly packagesService: IPositronPackagesService;
}

/**
 * The tabs the detail view can show. Security is only offered when the runtime
 * reported advisory data for the package.
 */
type PackageDetailTab = 'overview' | 'security';

/**
 * Normalize a runtime-provided published date to YYYY-MM-DD. Handles the common
 * case where the value already begins with an ISO date (e.g. R's
 * "2024-11-17 08:30:05 UTC"), falls back to Date parsing, and otherwise passes
 * the original string through unchanged.
 */
function formatPublishedDate(raw: string): string {
	const isoPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
	if (isoPrefix) {
		return isoPrefix[1];
	}
	const parsed = new Date(raw);
	if (!Number.isNaN(parsed.getTime())) {
		return parsed.toISOString().slice(0, 10);
	}
	return raw;
}

/**
 * Format a lookup timestamp (epoch ms) as YYYY-MM-DD for display. Read in the
 * reader's own time zone, unlike the advisory dates above: this one is a local
 * event ("when Positron asked"), so a UTC rendering would show tomorrow's date
 * to anyone who refreshed in the evening west of UTC.
 */
function formatFetchedDate(fetchedAt: number): string {
	const fetched = new Date(fetchedAt);
	const month = `${fetched.getMonth() + 1}`.padStart(2, '0');
	const day = `${fetched.getDate()}`.padStart(2, '0');
	return `${fetched.getFullYear()}-${month}-${day}`;
}

/**
 * A single stat in the Overview's top stat strip: an uppercase label above a
 * prominent value. Renders nothing if there is no value. The Overview is hidden
 * until the detail fetch resolves, so this never sees a pending value.
 */
const Stat = (props: { label: string; value: string | number | undefined }) => {
	const hasValue = props.value !== undefined && props.value !== '';
	if (!hasValue) {
		return null;
	}
	return (
		<div className='package-detail-stat'>
			<div className='package-detail-stat-label'>{props.label}</div>
			<div className='package-detail-stat-value'>{props.value}</div>
		</div>
	);
};

/**
 * A label/value row in the Metadata section. Renders nothing if there is no
 * value. The Overview is hidden until the detail fetch resolves, so this never
 * sees a pending value.
 */
const MetaRow = (props: { label: string; value: string | number | undefined }) => {
	const hasValue = props.value !== undefined && props.value !== '';
	if (!hasValue) {
		return null;
	}
	return (
		<>
			<div className='package-detail-meta-label'>{props.label}</div>
			<div className='package-detail-meta-value'>{props.value}</div>
		</>
	);
};

/**
 * A single advisory in the Security tab: severity + score, the advisory
 * id (linked to its NVD/OSV page when a URL is available), summary, and the
 * fixed-in / published metadata line.
 */
const VulnerabilityRow = (props: { vulnerability: IPackageVulnerability }) => {
	const services = usePositronReactServicesContext();
	const vulnerability = props.vulnerability;
	const band = severityBand(vulnerability.score);
	const severityText = vulnerability.score !== undefined
		? localize('positron.packages.detail.severityScored', "{0} {1}", severityBandLabel(band), vulnerability.score.toFixed(1))
		: severityBandLabel(band);
	return (
		<div className='package-detail-vulnerability'>
			<div className='package-detail-vulnerability-header'>
				<span className={positronClassNames('package-detail-vulnerability-severity', `severity-${band}`)}>
					{severityText}
				</span>
				{vulnerability.url ? (
					<Button
						ariaLabel={localize('positron.packages.detail.openAdvisory', "Open advisory {0}", vulnerability.id)}
						className='package-detail-vulnerability-id package-detail-vulnerability-link'
						onPressed={() => { void services.openerService.open(URI.parse(vulnerability.url!), { openExternal: true }); }}
					>
						{vulnerability.id}
					</Button>
				) : (
					<span className='package-detail-vulnerability-id'>{vulnerability.id}</span>
				)}
				{vulnerability.score !== undefined && vulnerability.scoreVersion && (
					<span className='package-detail-vulnerability-cvss'>
						{vulnerability.scoreVersion === 'v4'
							? localize('positron.packages.detail.cvssV4', "CVSS v4")
							: localize('positron.packages.detail.cvssV3', "CVSS v3")}
					</span>
				)}
			</div>
			{vulnerability.summary && (
				<div className='package-detail-vulnerability-summary'>{vulnerability.summary}</div>
			)}
			{(vulnerability.fixedIn || vulnerability.published) && (
				<div className='package-detail-vulnerability-meta'>
					{vulnerability.fixedIn && (
						<span>{localize('positron.packages.detail.fixedIn', "Fixed in {0}", vulnerability.fixedIn)}</span>
					)}
					{vulnerability.published && (
						<span>{localize('positron.packages.detail.advisoryPublished', "Published {0}", formatPublishedDate(vulnerability.published))}</span>
					)}
				</div>
			)}
		</div>
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

	// Detail fetch: call getPackageDetail when the package/session changes.
	// Initialize `detailLoading` to true when a live session exists so the very
	// first paint already reflects the pending fetch -- otherwise the Overview
	// would flash in (with no detail) for one frame before the effect runs.
	const [detail, setDetail] = useState<Partial<ILanguageRuntimePackage> | undefined>(undefined);
	const [detailLoading, setDetailLoading] = useState<boolean>(() =>
		!!packagesService.getInstances().find(i => i.session.metadata.sessionId === sessionId));
	useEffect(() => {
		const inst = packagesService.getInstances().find(i => i.session.metadata.sessionId === sessionId);
		if (!inst) {
			setDetail(undefined);
			setDetailLoading(false);
			return;
		}
		let cancelled = false;
		setDetail(undefined);
		setDetailLoading(true);
		inst.getPackageDetail(packageName)
			.then(d => { if (!cancelled) { setDetail(d); setDetailLoading(false); } })
			.catch(() => { if (!cancelled) { setDetail(undefined); setDetailLoading(false); } });
		return () => { cancelled = true; };
	}, [packagesService, sessionId, packageName]);

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
				// Reinstall the previously-installed version directly. `pkg` resolves
				// to the last-known package after an uninstall, so `pkg.version` is the
				// version that was installed. If we have no last-known package, pass no
				// version and let the command fall through to the version quick-pick.
				services.commandService.executeCommand('positronPackages.installPackage', packageName, pkg?.version);
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

	// Merge detail fields over the list entry. Detail-only fields (author,
	// sourceRepository, title, and potentially license/publishedDate)
	// are undefined until the fetch resolves; the list-derived fields are present
	// immediately.
	const merged = { ...pkg, ...detail };

	// Advisories ride in with the list metadata (Stage 2), not the detail
	// fetch, so they read off the merged entry and may appear after the
	// Overview first renders. `undefined` means no data (no PPM resolved, or
	// this package/version is unknown to it): render no Security section at
	// all rather than an affirmative "no vulnerabilities" that isn't earned.
	const vulnerabilitiesEnabled = usePositronConfiguration<boolean>(PACKAGES_VULNERABILITIES_ENABLED_SETTING) !== false;
	const vulnerabilities = vulnerabilitiesEnabled ? merged.vulnerabilities : undefined;

	// Which instance reported them, and when. An instance whose advisory data is
	// stale or absent reports every package as clean and nothing in its response
	// says so, so "no advisories" is only meaningful with the source attached.
	const vulnerabilitySource = vulnerabilitiesEnabled ? instance?.vulnerabilitySource : undefined;

	// Highest-severity first; unscored advisories sort after scored ones.
	const sortedVulnerabilities = vulnerabilities === undefined ? undefined : [...vulnerabilities].sort(
		(a, b) => (b.score ?? -1) - (a.score ?? -1));

	// Tab strip. Security is offered only when there is advisory data to show:
	// `undefined` means no data (no PPM configured, or this package/version is
	// unknown to it), which is neither a warning nor an earned all-clear.
	const tabs: PackageDetailTab[] = sortedVulnerabilities === undefined
		? ['overview']
		: ['overview', 'security'];
	const [selectedTab, setSelectedTab] = useState<PackageDetailTab>('overview');
	// Fall back to the Overview if the selected tab goes away -- e.g. the user
	// turns the vulnerabilities setting off while the Security tab is open.
	const activeTab = tabs.includes(selectedTab) ? selectedTab : 'overview';

	// Ids wire each tab to its panel. `useId` keeps them distinct when two
	// package editors are open side by side.
	const idPrefix = useId();
	const tabId = (tab: PackageDetailTab) => `${idPrefix}-tab-${tab}`;
	const panelId = (tab: PackageDetailTab) => `${idPrefix}-panel-${tab}`;

	const tabRefs = useRef<Partial<Record<PackageDetailTab, HTMLButtonElement | null>>>({});

	// Horizontal tablist keyboard model: arrows wrap, Home/End jump to the ends,
	// and selection follows focus (both panels are cheap to render).
	const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		const index = tabs.indexOf(activeTab);
		let nextIndex: number | undefined;
		switch (e.code) {
			case 'ArrowRight':
				nextIndex = (index + 1) % tabs.length;
				break;
			case 'ArrowLeft':
				nextIndex = (index - 1 + tabs.length) % tabs.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = tabs.length - 1;
				break;
		}
		if (nextIndex === undefined) {
			return;
		}
		// Consume the key before the Button's own Enter/Space handling sees it.
		e.preventDefault();
		e.stopPropagation();
		const nextTab = tabs[nextIndex];
		setSelectedTab(nextTab);
		tabRefs.current[nextTab]?.focus();
	};

	// Advisory count carried on the Security tab, coloured by the worst
	// advisory. Moving the advisories behind a tab would otherwise hide the one
	// thing about them worth noticing at a glance.
	const vulnerabilityCount = sortedVulnerabilities?.length ?? 0;
	const vulnerabilityBand = severityBand(maxVulnerabilityScore(sortedVulnerabilities ?? []));

	const renderTab = (tab: PackageDetailTab) => {
		const selected = tab === activeTab;
		const label = tab === 'overview'
			? localize('positron.packages.detail.overview', "Overview")
			: localize('positron.packages.detail.security', "Security");
		// Announce the count along with the tab name rather than leaving the
		// badge to be read as a bare number.
		const ariaLabel = tab === 'security' && vulnerabilityCount > 0
			? (vulnerabilityCount === 1
				? localize('positron.packages.detail.securityTabOne', "Security, 1 known vulnerability")
				: localize('positron.packages.detail.securityTabMany', "Security, {0} known vulnerabilities", vulnerabilityCount))
			: undefined;
		return (
			<Button
				key={tab}
				ref={element => { tabRefs.current[tab] = element; }}
				ariaControls={panelId(tab)}
				ariaLabel={ariaLabel}
				ariaSelected={selected}
				className={positronClassNames('package-detail-tab', { active: selected })}
				id={tabId(tab)}
				role='tab'
				tabIndex={selected ? 0 : -1}
				onKeyDown={handleTabKeyDown}
				onPressed={() => setSelectedTab(tab)}
			>
				{label}
				{tab === 'security' && vulnerabilityCount > 0 &&
					<span className={positronClassNames('package-detail-tab-badge', `severity-${vulnerabilityBand}`)}>
						{vulnerabilityCount}
					</span>
				}
			</Button>
		);
	};

	// Header subtitle: prefer the short one-line title (R's `Title`, Python's
	// `Summary`) over the longer list `description` (R's full Description).
	const subtitle = merged.title || pkg?.description;

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
					{detailLoading
						? <div className='package-detail-author'><span className='package-detail-skeleton' data-testid='package-detail-loading' /></div>
						: merged.author && <div className='package-detail-author'>{merged.author}</div>}
					{detailLoading
						? <div className='package-detail-description'><span className='package-detail-skeleton' data-testid='package-detail-loading' /></div>
						: subtitle && <div className='package-detail-description'>{subtitle}</div>}
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

			<div
				aria-label={localize('positron.packages.detail.tabs', "Package details")}
				className='package-detail-tabs'
				role='tablist'
			>
				{tabs.map(renderTab)}
			</div>

			{/*
			 * Every tab gets its panel, with the inactive ones hidden, so each
			 * tab's `aria-controls` resolves to an element that is really there.
			 * Both are cheap to render, which is also why selection follows
			 * focus in the tablist above.
			 */}
			{tabs.map(tab =>
				<div
					key={tab}
					aria-labelledby={tabId(tab)}
					className='package-detail-panel'
					hidden={tab !== activeTab}
					id={panelId(tab)}
					role='tabpanel'
					tabIndex={0}
				>
					{/*
					 * Hold the Overview back until the detail fetch resolves, then render
					 * it all at once. Half-rendering it with the list entry and filling in
					 * detail-only fields afterwards made the panel jump. The advisories
					 * ride in with the list metadata instead, so the Security tab has
					 * nothing to wait for.
					 */}
					{tab === 'overview' && !detailLoading &&
						<div className='package-detail-overview'>
							<div className='package-detail-stats'>
								<Stat label={localize('positron.packages.detail.version', "Version")} value={installedVersionText} />
								<Stat label={localize('positron.packages.detail.license', "License")} value={merged.license} />
							</div>

							<div className='package-detail-section'>
								<div className='package-detail-section-title'>{localize('positron.packages.detail.metadata', "Metadata")}</div>
								<div className='package-detail-meta-grid'>
									<MetaRow label={localize('positron.packages.detail.repository', "Source repository")} value={merged.sourceRepository} />
									<MetaRow label={localize('positron.packages.detail.published', "Date published")} value={merged.publishedDate ? formatPublishedDate(merged.publishedDate) : undefined} />
									<MetaRow label={localize('positron.packages.detail.interpreter', "Interpreter")} value={interpreter} />
								</div>
							</div>
						</div>
					}

					{tab === 'security' && sortedVulnerabilities !== undefined &&
						<div className='package-detail-security'>
							{sortedVulnerabilities.length === 0
								? <div className='package-detail-security-clean'>
									{vulnerabilitySource
										? localize('positron.packages.detail.noVulnerabilitiesFrom', "No advisories reported by {0} as of {1}.", vulnerabilitySource.host, formatFetchedDate(vulnerabilitySource.fetchedAt))
										: localize('positron.packages.detail.noVulnerabilities', "No advisories were reported for this version.")}
								</div>
								: <div className='package-detail-vulnerabilities'>
									{sortedVulnerabilities.map(vulnerability =>
										<VulnerabilityRow key={vulnerability.osvId} vulnerability={vulnerability} />)}
								</div>
							}
							{sortedVulnerabilities.length > 0 && vulnerabilitySource &&
								<div className='package-detail-security-source'>
									{localize('positron.packages.detail.advisorySource', "Reported by {0} as of {1}.", vulnerabilitySource.host, formatFetchedDate(vulnerabilitySource.fetchedAt))}
								</div>
							}
						</div>
					}
				</div>
			)}
		</div>
	);
};
