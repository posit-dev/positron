/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './missingPackagesBadge.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { Checkbox } from '../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
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
 * Builds the badge label, pluralized for a single missing package.
 */
export function missingPackagesLabel(total: number): string {
	return total === 1
		? localize('positron.missingPackages.badgeSingular', "{0} missing package", total)
		: localize('positron.missingPackages.badgePlural', "{0} missing packages", total);
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

	// Anchor element for the popup.
	const badgeRef = useRef<HTMLButtonElement>(undefined!);

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

	const label = missingPackagesLabel(result.total);

	// Open the dialog popup anchored to the badge.
	const showDialog = () => {
		if (!badgeRef.current) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			container: services.workbenchLayoutService.getContainer(DOM.getWindow(badgeRef.current)),
			parent: badgeRef.current,
		});

		renderer.render(
			<MissingPackagesDialog
				anchorElement={badgeRef.current}
				configurationService={configurationService}
				missingPackagesService={missingPackagesService}
				renderer={renderer}
				resource={result.resource}
				result={result}
			/>
		);
	};

	return (
		<button
			ref={badgeRef}
			aria-haspopup='dialog'
			aria-label={label}
			className='missing-packages-badge'
			data-testid='missing-packages-badge'
			title={label}
			onClick={showDialog}
		>
			<span className='codicon codicon-warning'></span>
			<span className='missing-packages-label'>{label}</span>
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

	const install = async () => {
		renderer.dispose();
		for (const group of result.groups) {
			await missingPackagesService.install(group);
		}
	};

	const onWarnChanged = (checked: boolean) => {
		configurationService.updateValue(WARN_MISSING_IN_EDITOR, checked, ConfigurationTarget.USER);
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
					<Button className='missing-packages-dialog-install' onPressed={install}>
						{installPackagesLabel(result)}
					</Button>
				</div>
				<div className='missing-packages-dialog-footer'>
					<Checkbox
						initialChecked={configurationService.getValue<boolean>(WARN_MISSING_IN_EDITOR) ?? true}
						label={localize('positron.missingPackages.showWarning', "Show warning for missing packages")}
						onChanged={onWarnChanged}
					/>
				</div>
			</div>
		</PositronModalPopup>
	);
};
