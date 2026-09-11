/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPositronAcademicLicenseService = createDecorator<IPositronAcademicLicenseService>('positronAcademicLicenseService');

/**
 * Reports what Positron knows about the license behind this session: whether it grants the
 * Education License Rider terms, and a hash identifying the license file it came from.
 *
 * Node/server: derived from the validated license (see `remoteLicenseKey.ts`'s
 * `ILicenseValidationResult`) at server startup. Browser: derived from the globals
 * injected by `webClientServer.ts` (see {@link licenseMarkerScript}). Desktop: academic is
 * always false and there is no hash, since desktop installs never go through a license
 * check.
 */
export interface IPositronAcademicLicenseService {
	readonly _serviceBrand: undefined;

	/** Whether this session is running under an academic license. */
	readonly isAcademic: boolean;

	/**
	 * A short, stable hash of the license file backing this session, sent to P3M as
	 * `positron-license-hash` so Posit can count session starts per license it issued.
	 * Undefined when the session has no license file to hash: desktop, a signed Posit
	 * Workbench token (per-connection, so hashing it would say nothing), and the AWS
	 * license manager (no key material). See `hashLicenseContents` in `localLicense.ts`.
	 */
	readonly licenseHash: string | undefined;
}

/** Name of the injected global that marks a browser session academic; see {@link licenseMarkerScript}. */
export const POSITRON_IS_ACADEMIC_GLOBAL = '_POSITRON_IS_ACADEMIC';

/** Name of the injected global carrying the license hash; see {@link licenseMarkerScript}. */
export const POSITRON_LICENSE_HASH_GLOBAL = '_POSITRON_LICENSE_HASH';

/** Shape of a license hash as `hashLicenseContents` in `localLicense.ts` produces it. */
const LICENSE_HASH_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Whether a value is a license hash as Positron produces them.
 *
 * Checked on both sides of the injected global: the server refuses to write a value that
 * is not one of ours into the served HTML, and the browser refuses to read one back out.
 * The browser check is what keeps an unexpected value out of outgoing P3M gallery URLs, so
 * neither side relies on the other having looked.
 */
export function isLicenseHash(value: unknown): value is string {
	return typeof value === 'string' && LICENSE_HASH_PATTERN.test(value);
}

/**
 * Builds the inline `<script>` that tells the browser what license this session runs under,
 * for injection into the served workbench HTML by `webClientServer.ts`. Each global is
 * emitted only when it has something to say, and the script is empty when neither does:
 * an absent academic global means false, and an absent hash global means no license file.
 */
export function licenseMarkerScript(isAcademic: boolean, licenseHash?: string): string {
	const assignments: string[] = [];
	if (isAcademic) {
		assignments.push(`globalThis.${POSITRON_IS_ACADEMIC_GLOBAL} = true;`);
	}
	if (isLicenseHash(licenseHash)) {
		assignments.push(`globalThis.${POSITRON_LICENSE_HASH_GLOBAL} = '${licenseHash}';`);
	}
	return assignments.length > 0 ? `<script>${assignments.join(' ')}</script>` : '';
}
