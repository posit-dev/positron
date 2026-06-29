/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './missingPackagesBadge.css';

// React.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { ProgressBar } from '../../../../base/browser/ui/positronComponents/progressBar.js';
import { PositronModalPopup } from '../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
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
 * The fallback chrome width (warning icon, dropdown arrow, padding and gaps), in
 * pixels, used to decide whether the badge fits before it has been measured
 * (e.g. when it starts out with no room and is never painted). Once the badge is
 * painted the real chrome width is measured and used instead.
 */
const DEFAULT_BADGE_CHROME_WIDTH = 46;

/**
 * Extra slack subtracted from the available width so a chosen tier is never a
 * few pixels too wide for its slot. Sibling widths are measured without their
 * margins, and the badge button carries a small right margin of its own, so a
 * conservative pad keeps the badge from overflowing its neighbors.
 */
const BADGE_SAFETY_PADDING = 6;

/**
 * Builds the badge label, pluralized for a single missing package.
 */
export function missingPackagesLabel(total: number): string {
	return total === 1
		? localize('positron.missingPackages.badgeSingular', "{0} missing package", total)
		: localize('positron.missingPackages.badgePlural', "{0} missing packages", total);
}

/**
 * Builds the medium-width badge label that drops the word "missing"
 * (e.g. "5 packages"), pluralized for a single missing package.
 */
export function missingPackagesShortLabel(total: number): string {
	return total === 1
		? localize('positron.missingPackages.badgeShortSingular', "{0} package", total)
		: localize('positron.missingPackages.badgeShortPlural', "{0} packages", total);
}

/**
 * The badge label tiers, widest first. The badge shows the widest tier that
 * fits the available width and falls back through the narrower tiers as space
 * runs out:
 *
 * - "5 missing packages"
 * - "5 packages"
 * - "5"
 * - "" (warning icon only)
 *
 * When even the icon-only tier does not fit, the badge hides entirely; it is a
 * passive indicator, not a vital one.
 *
 * @param total The number of missing packages.
 * @returns The tier label strings, widest first.
 */
export function missingPackagesBadgeTiers(total: number): string[] {
	return [
		missingPackagesLabel(total),
		missingPackagesShortLabel(total),
		String(total),
		'',
	];
}

/**
 * Chooses the widest badge tier that fits the available width.
 *
 * @param availableWidth The width available to the badge, in pixels.
 * @param chromeWidth The fixed width of the badge chrome (warning icon,
 *   dropdown arrow, padding and gaps), in pixels.
 * @param tierTextWidths The measured text width of each tier, widest first.
 * @returns The index of the widest tier that fits, or -1 when even the
 *   narrowest (icon-only) tier does not fit and the badge should be hidden.
 */
export function chooseMissingPackagesTier(availableWidth: number, chromeWidth: number, tierTextWidths: number[]): number {
	for (let i = 0; i < tierTextWidths.length; i++) {
		if (chromeWidth + tierTextWidths[i] <= availableWidth) {
			return i;
		}
	}
	return -1;
}

/**
 * Builds the install-button label. For a single package it names the package
 * (e.g. "Install 'polars'"); otherwise it reports the count.
 */
export function installPackagesLabel(result: IMissingPackagesResult): string {
	if (result.total === 1) {
		const only = result.groups.find(g => g.packages.length > 0)?.packages[0];
		if (only) {
			return localize('positron.missingPackages.installNamed', "Install '{0}'", only.name);
		}
	}
	return localize('positron.missingPackages.installPlural', "Install {0} packages", result.total);
}

/**
 * Collects the names of every missing package across a result's groups,
 * preserving order. Used by the installing dialog to name what is installing.
 */
function installingPackageNames(result: IMissingPackagesResult): string[] {
	return result.groups.flatMap(group => group.packages.map(pkg => pkg.name));
}

/**
 * Builds the message shown while packages are installing, naming the package
 * (e.g. "Installing missing package 'polars'") or listing them when there are
 * several (e.g. "Installing missing packages: 'foo', 'bar'").
 */
export function installingMessage(result: IMissingPackagesResult): string {
	const names = installingPackageNames(result);
	if (names.length === 1) {
		return localize('positron.missingPackages.installingSingular', "Installing missing package '{0}'", names[0]);
	}
	const quoted = names.map(name => `'${name}'`).join(', ');
	return localize('positron.missingPackages.installingPlural', "Installing missing packages: {0}", quoted);
}

/**
 * A shared badge for the editor action bar and the Positron notebook toolbar
 * that warns when the current document references packages that are not
 * installed, and offers to install them.
 *
 * Renders nothing until data arrives and never blocks render: it subscribes to
 * the missing-packages service and computes asynchronously. Clicking the badge
 * opens a dialog popup listing the missing packages with an install action.
 */
export const MissingPackagesBadge = (props: MissingPackagesBadgeProps) => {
	const { resource, missingPackagesService, configurationService } = props;

	// Services (for opening the modal popup).
	const services = usePositronReactServicesContext();

	// Anchor element for the popup; also the element whose available width is
	// measured to choose a responsive label tier.
	const badgeRef = useRef<HTMLButtonElement>(undefined!);

	// The label element, used to measure the badge chrome (everything except the
	// label text) by subtracting the label width from the button width.
	const labelRef = useRef<HTMLSpanElement>(null);

	// Cached chrome width and label font, captured while the badge is painted so
	// they remain available to recompute the tier even while the badge is hidden.
	const chromeWidthRef = useRef<number>(DEFAULT_BADGE_CHROME_WIDTH);
	const fontRef = useRef<string>('');

	// A reusable canvas for measuring tier text widths.
	const canvasRef = useRef<HTMLCanvasElement | undefined>(undefined);

	// The renderer for the currently open dialog, if any. Tracked so the dialog
	// can be torn down if the badge unmounts; otherwise an unmount (e.g. an
	// action-bar re-render) would orphan a popup anchored to a detached button.
	const rendererRef = useRef<PositronModalReactRenderer | undefined>(undefined);

	const [result, setResult] = useState<IMissingPackagesResult | undefined>(() =>
		resource ? missingPackagesService.getCached(resource) : undefined);
	const [warnEnabled, setWarnEnabled] = useState<boolean>(() =>
		configurationService.getValue<boolean>(WARN_MISSING_IN_EDITOR) ?? true);

	// Whether an install is in progress for this resource. While installing, the
	// badge shows a spinner and "Installing" rather than the warning treatment,
	// so it never looks like nothing happened after the user chose to install.
	const [installing, setInstalling] = useState<boolean>(() =>
		resource ? missingPackagesService.getInstalling(resource) !== undefined : false);

	// The index of the label tier to show (0 = widest), or -1 to hide the badge
	// because even the icon-only tier does not fit. Starts at the widest tier;
	// the layout effect below corrects it before paint.
	const [tierIndex, setTierIndex] = useState(0);

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

	// Track whether an install is in progress for this resource.
	useEffect(() => {
		if (!resource) {
			setInstalling(false);
			return;
		}
		setInstalling(missingPackagesService.getInstalling(resource) !== undefined);
		const disposable = missingPackagesService.onDidChangeInstalling(uri => {
			if (uri.toString() === resource.toString()) {
				setInstalling(missingPackagesService.getInstalling(resource) !== undefined);
			}
		});
		return () => disposable.dispose();
	}, [resource, missingPackagesService]);

	// Tear down any open dialog when the badge unmounts.
	useEffect(() => () => {
		rendererRef.current?.dispose();
		rendererRef.current = undefined;
	}, []);

	// While installing, render against the snapshot captured when the install
	// began so the badge keeps its size and label even as the live result drops
	// to zero (the cache invalidates as each group finishes).
	const installSnapshot = installing && resource ? missingPackagesService.getInstalling(resource) : undefined;
	const activeResult = installSnapshot ?? result;

	// Whether the badge has anything to show and is allowed to. When this is true
	// the button is always mounted (it may still be visually hidden via the tier
	// below) so its width can be measured and recovered on resize. An in-progress
	// install keeps the badge mounted so its spinner stays visible.
	const total = activeResult?.total ?? 0;
	const visible = warnEnabled && (installing || total > 0);

	// Choose a responsive label tier based on the width available to the badge.
	//
	// The action bar sizes the badge to its content, so measuring the badge's
	// own width cannot tell us when more room becomes available. We also cannot
	// use the badge's action bar region width: when the bar overflows, the
	// (right-aligned) region extends off-screen past the action bar, and its left
	// edge moves as the badge itself grows or shrinks. Both would feed back into
	// the measurement.
	//
	// Instead we bound the badge by two content-independent edges: the right edge
	// of the left action bar region (where the right region's space begins) and
	// the action bar's own right edge (where content is clipped by the editor
	// pane). The widths of the badge's siblings in the right region are then
	// reserved. The result is the room the badge can occupy regardless of its
	// current label, so the tier both shrinks and grows back as the editor is
	// resized.
	useLayoutEffect(() => {
		const button = badgeRef.current;
		// Freeze the tier while installing so the label stays put: "Installing"
		// (or the count) should not jump tiers as the badge text changes width.
		if (!visible || !button || installing) {
			return;
		}

		// The badge's widget container, its action bar region, and the action bar
		// root (whose right edge is the clipping boundary for the editor pane).
		const widget = button.parentElement;
		const region = widget?.parentElement;
		const actionBar = button.closest('.positron-action-bar');
		if (!widget || !region || !actionBar) {
			return;
		}

		const win = DOM.getWindow(button);

		const measure = () => {
			// While the badge is painted, capture the chrome width (everything
			// except the label text) and the label font for later use.
			const labelElement = labelRef.current;
			if (labelElement && button.offsetWidth > 0) {
				const chromeWidth = button.offsetWidth - labelElement.offsetWidth;
				if (chromeWidth > 0) {
					chromeWidthRef.current = chromeWidth;
				}
				fontRef.current = win.getComputedStyle(labelElement).font || fontRef.current;
			}

			// The right region's available span runs from the right edge of the
			// left region (or the action bar's content start) to the action bar's
			// content right edge.
			const actionBarRect = actionBar.getBoundingClientRect();
			const actionBarStyle = win.getComputedStyle(actionBar);
			const rightEdge = actionBarRect.right - (parseFloat(actionBarStyle.paddingRight) || 0);
			const leftRegion = region.previousElementSibling;
			const leftEdge = leftRegion
				? leftRegion.getBoundingClientRect().right
				: actionBarRect.left + (parseFloat(actionBarStyle.paddingLeft) || 0);

			// Reserve the widths of the badge's siblings in the right region.
			let available = rightEdge - leftEdge - BADGE_SAFETY_PADDING;
			for (let i = 0; i < region.children.length; i++) {
				const child = region.children[i];
				if (child !== widget) {
					available -= (child as HTMLElement).offsetWidth;
				}
			}

			// Measure each tier's text width and choose the widest tier that fits.
			const canvas = canvasRef.current ?? (canvasRef.current = win.document.createElement('canvas'));
			const context = canvas.getContext('2d');
			if (!context) {
				return;
			}
			if (fontRef.current) {
				context.font = fontRef.current;
			}
			const tierTextWidths = missingPackagesBadgeTiers(total).map(
				text => text ? Math.ceil(context.measureText(text).width) : 0);
			const chosen = chooseMissingPackagesTier(available, chromeWidthRef.current, tierTextWidths);
			setTierIndex(prev => prev === chosen ? prev : chosen);
		};

		// Measure now, then whenever the action bar (and thus the editor pane) or
		// the left region (whose right edge bounds the badge) changes size.
		measure();
		const resizeObserver = new win.ResizeObserver(() => measure());
		resizeObserver.observe(actionBar);
		const leftRegion = region.previousElementSibling;
		if (leftRegion) {
			resizeObserver.observe(leftRegion);
		}
		return () => resizeObserver.disconnect();
	}, [visible, total, installing]);

	// Render nothing when disabled or there is nothing to show.
	if (!visible || !activeResult) {
		return null;
	}

	const hidden = tierIndex < 0;

	// The full label is used for the tooltip and accessible name. While
	// installing it names what is being installed; otherwise it is the widest
	// tier (e.g. "5 missing packages").
	const label = installing
		? installingMessage(activeResult)
		: missingPackagesBadgeTiers(activeResult.total)[0];

	// The visible badge text. While installing it reads "Installing" except when
	// the available width has collapsed to the count-only tier, which is kept so
	// the badge does not change width. When not installing it is the chosen tier.
	const tierLabel = hidden ? '' : missingPackagesBadgeTiers(activeResult.total)[tierIndex];
	const installingLabel = localize('positron.missingPackages.installingBadge', "Installing");
	const displayLabel = installing && !hidden && tierIndex <= 1 ? installingLabel : tierLabel;

	// Open the dialog popup anchored to the badge. While installing this shows a
	// progress dialog; otherwise it offers to install the missing packages.
	const showDialog = () => {
		if (!badgeRef.current) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			container: services.workbenchLayoutService.getContainer(DOM.getWindow(badgeRef.current)),
			parent: badgeRef.current,
			onDisposed: () => { rendererRef.current = undefined; },
		});
		rendererRef.current = renderer;

		renderer.render(
			installing
				? <InstallingPackagesDialog
					anchorElement={badgeRef.current}
					missingPackagesService={missingPackagesService}
					renderer={renderer}
					resource={activeResult.resource}
					result={activeResult}
				/>
				: <MissingPackagesDialog
					anchorElement={badgeRef.current}
					configurationService={configurationService}
					missingPackagesService={missingPackagesService}
					renderer={renderer}
					resource={activeResult.resource}
					result={activeResult}
				/>
		);
	};

	return (
		<button
			ref={badgeRef}
			aria-haspopup='dialog'
			aria-label={label}
			className={positronClassNames('missing-packages-badge', { 'missing-packages-badge-hidden': hidden })}
			data-testid='missing-packages-badge'
			title={label}
			onClick={showDialog}
		>
			{installing
				? <span className='codicon codicon-sync codicon-modifier-spin'></span>
				: <span className='codicon codicon-warning'></span>}
			<span ref={labelRef} className='missing-packages-label'>{displayLabel}</span>
			<span className='codicon codicon-positron-drop-down-arrow'></span>
		</button>
	);
};

/**
 * MissingPackagesDialog props.
 */
interface MissingPackagesDialogProps {
	readonly anchorElement: HTMLElement;
	readonly renderer: PositronModalReactRenderer;
	readonly resource: URI;
	readonly result: IMissingPackagesResult;
	readonly missingPackagesService: IMissingPackagesService;
	readonly configurationService: IConfigurationService;
}

/**
 * MissingPackagesDialog component.
 *
 * A dialog popup that lists the packages a document references but that are not
 * installed, and offers an action to install them all.
 */
const MissingPackagesDialog = (props: MissingPackagesDialogProps) => {
	const { resource, result, missingPackagesService, configurationService, renderer } = props;

	const services = usePositronReactServicesContext();

	const fileName = basename(resource);

	// Name the language when the document references a single language, so the
	// message can read "the following Python packages".
	const languageIds = [...new Set(result.groups.map(g => g.languageId))];
	const languageName = languageIds.length === 1
		? services.languageService.getLanguageName(languageIds[0])
		: null;

	const install = () => {
		renderer.dispose();
		// Fire and forget: installAll tracks the installing state so the badge
		// switches to its spinner immediately, without blocking on the install.
		missingPackagesService.installAll(result);
	};

	// Disable the badge for future documents, dismiss the dialog, and let the
	// user know how to turn the warning back on.
	const dontShowAgain = () => {
		configurationService.updateValue(WARN_MISSING_IN_EDITOR, false, ConfigurationTarget.USER);
		renderer.dispose();

		// Link to the setting that re-enables the warning. The notification
		// renders markdown command links, so clicking opens the Settings editor
		// filtered to the setting.
		const settingLink = `command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify([WARN_MISSING_IN_EDITOR]))}`;
		services.notificationService.info(localize(
			'positron.missingPackages.dontShowAgainNotification',
			"Positron won't warn you again about missing packages in your code. You can turn this behavior back on using the [{0}]({1}) setting.",
			localize('positron.missingPackages.settingName', "Warn About Missing Packages in Editor"),
			settingLink));
	};

	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height='auto'
			keyboardNavigationStyle='dialog'
			popupAlignment='right'
			popupPosition='bottom'
			renderer={renderer}
			width={360}
		>
			<div className='missing-packages-dialog'>
				<div className='missing-packages-dialog-message'>
					{/* The filename is a non-localizable identifier rendered as a
						monospace element, followed by a complete localized clause. */}
					<code className='missing-packages-dialog-filename'>{fileName}</code>
					{' '}
					{languageName
						? localize('positron.missingPackages.dialogMessageLang', "depends on the following {0} packages, but they are not installed:", languageName)
						: localize('positron.missingPackages.dialogMessage', "depends on the following packages, but they are not installed:")}
				</div>
				<ul className='missing-packages-dialog-list'>
					{result.groups.flatMap(group => group.packages.map(pkg => (
						<li key={`${group.sessionId}:${pkg.name}`}>
							{pkg.referencedName && pkg.referencedName !== pkg.name
								? localize('positron.missingPackages.itemAlias', "{0} (for {1})", pkg.name, pkg.referencedName)
								: pkg.name}
						</li>
					)))}
				</ul>
				<div className='missing-packages-dialog-actions'>
					<Button className='missing-packages-dialog-button' onPressed={dontShowAgain}>
						{localize('positron.missingPackages.dontShowAgain', "Don't Show Again")}
					</Button>
					<Button className='missing-packages-dialog-button default' onPressed={install}>
						{installPackagesLabel(result)}
					</Button>
				</div>
			</div>
		</PositronModalPopup>
	);
};

/**
 * InstallingPackagesDialog props.
 */
interface InstallingPackagesDialogProps {
	readonly anchorElement: HTMLElement;
	readonly renderer: PositronModalReactRenderer;
	readonly resource: URI;
	readonly result: IMissingPackagesResult;
	readonly missingPackagesService: IMissingPackagesService;
}

/**
 * InstallingPackagesDialog component.
 *
 * A dialog popup shown when the badge is clicked while an install is already in
 * progress. It names the packages being installed and shows an indeterminate
 * progress bar. It closes itself when the install finishes.
 */
const InstallingPackagesDialog = (props: InstallingPackagesDialogProps) => {
	const { resource, result, missingPackagesService, renderer } = props;

	// Close the dialog when the install finishes (the resource is no longer
	// installing), so it does not linger after the badge returns to normal.
	useEffect(() => {
		const disposable = missingPackagesService.onDidChangeInstalling(uri => {
			if (uri.toString() === resource.toString() && !missingPackagesService.getInstalling(resource)) {
				renderer.dispose();
			}
		});
		return () => disposable.dispose();
	}, [resource, missingPackagesService, renderer]);

	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height='auto'
			keyboardNavigationStyle='dialog'
			popupAlignment='right'
			popupPosition='bottom'
			renderer={renderer}
			width={360}
		>
			<div className='missing-packages-dialog'>
				<div className='missing-packages-dialog-message'>
					{installingMessage(result)}
				</div>
				<div className='missing-packages-installing-progress'>
					<ProgressBar />
				</div>
			</div>
		</PositronModalPopup>
	);
};
