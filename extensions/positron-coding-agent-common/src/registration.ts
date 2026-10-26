/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** Something that can be disposed, e.g. a `vscode.Disposable`. */
export interface Disposable {
	dispose(): unknown;
}

/** A registration kept in place while its coding agent is installed. */
export interface InstalledRegistration extends Disposable {
	/**
	 * Check whether the agent is installed, and register or unregister to
	 * match. Resolves once the registration follows the latest check.
	 */
	update(): Promise<void>;
}

/**
 * Keep a coding agent registered while it's installed, so the
 * `ai.errorActions.agent` setting lists it. Nothing is checked until
 * {@link InstalledRegistration.update} is called; call it on activation and
 * whenever the agent may have been installed or removed.
 * @param isInstalled Whether the agent is installed.
 * @param register Register the agent, e.g. with
 *   `positron.ai.registerErrorActionHandler`.
 */
export function registerWhileInstalled(isInstalled: () => Promise<boolean>, register: () => Disposable): InstalledRegistration {
	let registration: Disposable | undefined;
	let isDisposed = false;

	// Checks run one at a time, so the registration follows the latest
	// result; a check requested during another runs once that one finishes.
	let checking: Promise<void> | undefined;
	let isCheckRequested = false;
	const check = async () => {
		do {
			isCheckRequested = false;
			const installed = await isInstalled();
			if (isDisposed) {
				return;
			}
			if (installed && !registration) {
				registration = register();
			} else if (!installed && registration) {
				registration.dispose();
				registration = undefined;
			}
		} while (isCheckRequested);
	};

	return {
		update: () => {
			if (checking) {
				isCheckRequested = true;
				return checking;
			}
			checking = check().finally(() => checking = undefined);
			return checking;
		},
		dispose: () => {
			isDisposed = true;
			registration?.dispose();
			registration = undefined;
		},
	};
}
