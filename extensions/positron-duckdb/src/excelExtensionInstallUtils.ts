/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers used by `scripts/install-excel-extension.ts` to vendor the DuckDB
 * `excel` extension. They live here (rather than inline in the script) so they can
 * be unit-tested: the script auto-runs `main()` on import and reads `package.json`
 * for its pins, neither of which a focused byte-level test should trigger. See the
 * install script's header comment for the full integrity/signing rationale.
 */

import * as crypto from 'crypto';

/**
 * Truncate a thin 64-bit Mach-O to the end of its last segment, dropping any
 * trailing data. DuckDB signs its extensions by appending a footer past the end
 * of the Mach-O image (it does NOT add an `LC_CODE_SIGNATURE` load command), and
 * that trailing footer is what trips Apple's strict validation. Returns the
 * truncated bytes, or `undefined` if `bytes` is not a thin 64-bit Mach-O with
 * trailing data to strip (e.g. a fat binary, a non-Mach-O artifact, or a file
 * with no bytes past its last segment). Downloads are always thin, per-arch
 * artifacts, so the fat case does not arise here; the guard just keeps this safe
 * if that ever changes.
 *
 * The end of the image is the maximum of `fileoff + filesize` across every
 * `LC_SEGMENT_64`. The code signature (if any) lives inside `__LINKEDIT`, so a
 * segment-based end also covers an `LC_CODE_SIGNATURE` when one is present.
 */
export function stripMachOTrailingData(bytes: Buffer): Buffer | undefined {
	// DuckDB ships x86_64 / arm64 extensions, which are little-endian 64-bit
	// Mach-O. Only handle that; treat anything else (fat, big-endian, non-Mach-O)
	// as "nothing to strip".
	const MH_MAGIC_64 = 0xfeedfacf;
	const LC_SEGMENT_64 = 0x19;

	if (bytes.length < 32 || bytes.readUInt32LE(0) !== MH_MAGIC_64) {
		return undefined;
	}

	const ncmds = bytes.readUInt32LE(16); // mach_header_64: magic, cputype, cpusubtype, filetype, ncmds, ...
	let offset = 32; // size of mach_header_64
	let imageEnd = 0;
	for (let i = 0; i < ncmds && offset + 8 <= bytes.length; i++) {
		const cmd = bytes.readUInt32LE(offset);
		const cmdsize = bytes.readUInt32LE(offset + 4);
		if (cmd === LC_SEGMENT_64) {
			// segment_command_64: cmd, cmdsize, segname[16], vmaddr(8), vmsize(8),
			// fileoff(8) @ +40, filesize(8) @ +48, ...
			const fileoff = Number(bytes.readBigUInt64LE(offset + 40));
			const filesize = Number(bytes.readBigUInt64LE(offset + 48));
			imageEnd = Math.max(imageEnd, fileoff + filesize);
		}
		offset += cmdsize;
	}
	return imageEnd > 0 && imageEnd < bytes.length ? bytes.subarray(0, imageEnd) : undefined;
}

/**
 * Verify the downloaded (decompressed) extension matches the SHA-256 pinned for
 * its platform. This is our integrity anchor: we strip DuckDB's own signature on
 * macOS, so the pin is what protects against a tampered or corrupted download.
 * Verify before any stripping, so the pin matches the canonical artifact DuckDB
 * publishes.
 *
 * `expected` is the pinned hash for `duckdbPlatformName` (read from package.json
 * by the caller), or `undefined` if no pin exists yet. Throws with an actionable
 * message on a missing pin or a mismatch.
 */
export function verifyExtensionHash(bytes: Buffer, expected: string | undefined, duckdbPlatformName: string): void {
	if (!expected) {
		throw new Error(
			`Missing positron.duckdbExcelExtensionHashes.${duckdbPlatformName} in package.json. ` +
			'Run `npm run print-excel-hashes` and paste the result to pin the expected hashes.'
		);
	}
	const actual = crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
	if (actual !== expected) {
		throw new Error(
			`SHA-256 mismatch for the DuckDB Excel extension (${duckdbPlatformName}): expected ` +
			`${expected}, got ${actual}. The download may be corrupt or tampered with. If the ` +
			'pinned version changed, regenerate hashes with `npm run print-excel-hashes`.'
		);
	}
}
