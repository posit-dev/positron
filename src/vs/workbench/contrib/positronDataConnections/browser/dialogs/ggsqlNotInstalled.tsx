/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of the ggsql Not Installed dialog.
const GGSQL_NOT_INSTALLED_WIDTH = 460;

/**
 * The language id of ggsql connection code. Positron does not register this language itself -- it is
 * the id the data connection drivers generate ggsql code under, and the id a ggsql runtime would
 * register itself under.
 */
export const GGSQL_LANGUAGE_ID = 'ggsql';

/**
 * Where the user goes to install ggsql.
 */
export const GGSQL_INSTALL_URL = 'https://ggsql.org/';

/**
 * How GGSQL_INSTALL_URL is written when it is shown as link text. Not localized: it is a domain
 * name, and showing the bare domain says plainly that the link leaves Positron for the web.
 */
export const GGSQL_INSTALL_LABEL = 'ggsql.org';

/**
 * Whether the given language is ggsql and Positron can be certain it is not installed.
 *
 * The precondition that matters is the one `IPositronConsoleService.executeCode` fails on: with no
 * runtime registered for the language, there is nothing to run the connection code in. That check is
 * equivalent to `IRuntimeStartupService.getPreferredRuntime` returning undefined, whose last
 * fallback is this same lookup.
 *
 * Runtime discovery is asynchronous, so an empty registration list only means "not installed" once
 * discovery has settled. `Complete` alone is not enough -- a background revalidation pass can still
 * be registering runtimes after the phase advances -- so both signals are consulted. While discovery
 * is in flight this reports false: letting Connect run and report what it hits is better than
 * telling the user to install software they may already have.
 *
 * @param services The Positron React services.
 * @param languageId The language id of the connection code.
 * @returns True when the code is ggsql and no ggsql runtime exists to run it.
 */
export function isGgsqlKnownMissing(services: PositronReactServices, languageId: string): boolean {
	if (languageId !== GGSQL_LANGUAGE_ID) {
		return false;
	}

	if (services.languageRuntimeService.startupPhase !== RuntimeStartupPhase.Complete ||
		services.runtimeStartupService.backgroundDiscoveryInProgress) {
		return false;
	}

	return !services.languageRuntimeService.registeredRuntimes.some(
		runtime => runtime.languageId === GGSQL_LANGUAGE_ID
	);
}

/**
 * Opens the ggsql website, where the user can install ggsql. Opens in the system browser rather than
 * in Positron: the page exists to be downloaded from.
 * @param services The Positron React services.
 */
export function openGgsqlInstallPage(services: PositronReactServices) {
	services.openerService.open(URI.parse(GGSQL_INSTALL_URL), { openExternal: true });
}

/**
 * Shows the ggsql Not Installed dialog, which explains that the generated connection code cannot be
 * run because Positron found no ggsql runtime, and offers to open the ggsql website. The dialog that
 * opened it stays behind it, so the user can still copy the code or create a script from it.
 * @param services The Positron React services.
 */
export const showGgsqlNotInstalled = (services: PositronReactServices) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Render the dialog.
	renderer.render(
		<GgsqlNotInstalled
			renderer={renderer}
			onClose={() => renderer.dispose()}
			onOpenInstallPage={() => {
				openGgsqlInstallPage(services);
				renderer.dispose();
			}}
		/>
	);
};

/**
 * GgsqlNotInstalledProps interface.
 */
interface GgsqlNotInstalledProps {
	readonly renderer: PositronModalReactRenderer;
	readonly onOpenInstallPage: () => void;
	readonly onClose: () => void;
}

/**
 * GgsqlNotInstalled component.
 * @param props The component props.
 */
const GgsqlNotInstalled = (props: GgsqlNotInstalledProps) => {
	return (
		<PositronDynamicModalDialog
			content={
				<div>
					{localize(
						'positron.ggsqlNotInstalled.detail',
						"Positron could not find ggsql, so this connection code cannot be run in a console. You can still copy the code or create a script for it."
					)}
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.ggsqlNotInstalled.openInstallPage', "Go to ggsql.org")}
					secondaryButtonTitle={localize('positron.ggsqlNotInstalled.close', "Close")}
					onPrimaryButton={props.onOpenInstallPage}
					onSecondaryButton={props.onClose}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.ggsqlNotInstalled.title', "ggsql Not Installed")}
			width={GGSQL_NOT_INSTALLED_WIDTH}
			onCancel={props.onClose}
		/>
	);
};
