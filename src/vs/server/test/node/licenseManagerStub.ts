/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A stand-in for the license-manager-aws-sagemaker binary, for tests.
 *
 * The frames below are fabricated. They keep the same shape as
 * the real wire format — a base64-looking line, then a single JSON line — since
 * that shape is what licenseManagerStream.ts and its tests depend on.
 */

/** Stands in for the real HMAC line; not a real signature. */
const FAKE_HMAC_LINE = 'ZmFrZS1zaWduYXR1cmUtbm90LWEtcmVhbC1obWFj';

/** A frame reporting an active lease. */
export const ACTIVATED_FRAME =
	`${FAKE_HMAC_LINE}\n` +
	'{"status":"activated","expiration":9999999999000,"ts":1700000000000,' +
	'"product-key":"","shiny-users":"0","users":"5","user-activity-days":"0",' +
	'"allow-apis":"1","days-left":7,"has-key":false,"has-trial":false,' +
	'"license-scope":"","sessions":"0","enable-launcher":"1","max-repo-count":"0"}\n';

/** A frame reporting no checked-out lease (expiration is 0, not a date). */
export const EXPIRED_FRAME =
	`${FAKE_HMAC_LINE}\n` +
	'{"status":"expired","expiration":0,"ts":1700000010000,' +
	'"product-key":"","shiny-users":"0","users":"0","user-activity-days":"0",' +
	'"allow-apis":"","days-left":0,"has-key":false,"has-trial":false,' +
	'"license-scope":"","sessions":"0","enable-launcher":"0","max-repo-count":"0"}\n';

/** A frame reporting a lease that existed and lapsed (expiration is a past date, not 0). */
export const EXPIRED_WITH_PAST_EXPIRATION_FRAME =
	`${FAKE_HMAC_LINE}\n` +
	'{"status":"expired","expiration":1600000000000,"ts":1700000020000,' +
	'"product-key":"","shiny-users":"0","users":"0","user-activity-days":"0",' +
	'"allow-apis":"","days-left":0,"has-key":false,"has-trial":false,' +
	'"license-scope":"","sessions":"0","enable-launcher":"0","max-repo-count":"0"}\n';

/**
 * Source for the stub, run with `node -e` (the repo does not allow new
 * JavaScript files, so it cannot live on disk as a script).
 *
 * It reproduces the parts of the real binary's contract that matter here:
 * two-line stdout frames, staying alive between refreshes, and checking the
 * seat in on SIGTERM before exiting. LM_STUB_MODE selects the behaviour:
 *
 *   activated      (default) emit one activated frame, then idle until SIGTERM
 *   expired        emit one expired frame, then idle until SIGTERM
 *   exit           emit one activated frame, then exit 3 on its own
 *   stderr         write to stderr only, emit no frames, then idle
 *   ignore-sigterm emit one activated frame and never exit voluntarily
 *   flip           emit activated, then expired frames from LM_STUB_FLIP_MS on,
 *                  mirroring a license lost mid-session
 *
 * On SIGTERM it exits with code 42, which lets a test prove the signal was
 * delivered and handled rather than the process being killed outright.
 */
export const LICENSE_MANAGER_STUB_SOURCE = `
const mode = process.env.LM_STUB_MODE || 'activated';
const ACTIVATED = '${ACTIVATED_FRAME.replace(/\n/g, '\\n')}';
const EXPIRED = '${EXPIRED_FRAME.replace(/\n/g, '\\n')}';
if (mode !== 'ignore-sigterm') {
	process.on('SIGTERM', () => process.exit(42));
} else {
	process.on('SIGTERM', () => {});
}
if (mode === 'expired') {
	process.stdout.write(EXPIRED);
	setInterval(() => process.stdout.write(EXPIRED), 50);
} else if (mode === 'stderr') {
	process.stderr.write('stub diagnostic line, not a frame\\n');
} else if (mode === 'exit') {
	process.stdout.write(ACTIVATED);
	setTimeout(() => process.exit(3), 30);
} else if (mode === 'flip') {
	process.stdout.write(ACTIVATED);
	setTimeout(() => {
		process.stdout.write(EXPIRED);
		setInterval(() => process.stdout.write(EXPIRED), 50);
	}, Number(process.env.LM_STUB_FLIP_MS || 100));
} else {
	process.stdout.write(ACTIVATED);
}
setInterval(() => {}, 1000);
`;
