/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as crypto from 'crypto';
import { stripMachOTrailingData, verifyExtensionHash } from '../excelExtensionInstallUtils';

// Mach-O constants and structure offsets, mirrored from the values
// stripMachOTrailingData parses (see its implementation for layout details).
const MH_MAGIC_64 = 0xfeedfacf;
const LC_SEGMENT_64 = 0x19;
const LC_UUID = 0x1b; // an arbitrary non-segment load command
const HEADER_SIZE = 32; // sizeof(mach_header_64)
const SEGMENT_CMD_SIZE = 72; // sizeof(segment_command_64) with no sections
const NON_SEGMENT_CMD_SIZE = 16; // any small load command we don't parse

interface FakeCommand {
	cmd: number;
	/** Only meaningful for LC_SEGMENT_64; ignored otherwise. */
	fileoff?: number;
	filesize?: number;
}

/**
 * Build a synthetic little-endian thin 64-bit Mach-O buffer of `totalLength`
 * bytes containing the given load commands. Only the fields stripMachOTrailingData
 * reads are populated; everything else stays zero. `totalLength` lets a test add
 * trailing bytes past the segment-defined image end (the DuckDB footer case).
 */
function buildMachO(commands: FakeCommand[], totalLength: number, magic = MH_MAGIC_64): Buffer {
	const buf = Buffer.alloc(totalLength);
	buf.writeUInt32LE(magic, 0);
	buf.writeUInt32LE(commands.length, 16); // ncmds
	let offset = HEADER_SIZE;
	for (const command of commands) {
		const cmdsize = command.cmd === LC_SEGMENT_64 ? SEGMENT_CMD_SIZE : NON_SEGMENT_CMD_SIZE;
		buf.writeUInt32LE(command.cmd, offset);
		buf.writeUInt32LE(cmdsize, offset + 4);
		if (command.cmd === LC_SEGMENT_64) {
			buf.writeBigUInt64LE(BigInt(command.fileoff ?? 0), offset + 40);
			buf.writeBigUInt64LE(BigInt(command.filesize ?? 0), offset + 48);
		}
		offset += cmdsize;
	}
	return buf;
}

suite('excelExtensionInstallUtils', () => {
	suite('stripMachOTrailingData', () => {
		test('truncates to the segment image end when trailing data is present', () => {
			// One segment ending at byte 200, then 56 trailing footer bytes.
			const bytes = buildMachO([{ cmd: LC_SEGMENT_64, fileoff: 0, filesize: 200 }], 256);
			const stripped = stripMachOTrailingData(bytes);
			assert.strictEqual(stripped?.length, 200);
		});

		test('uses the maximum image end across multiple segments', () => {
			const bytes = buildMachO([
				{ cmd: LC_SEGMENT_64, fileoff: 0, filesize: 120 },
				{ cmd: LC_SEGMENT_64, fileoff: 120, filesize: 100 }, // ends at 220
			], 300);
			const stripped = stripMachOTrailingData(bytes);
			assert.strictEqual(stripped?.length, 220);
		});

		test('returns undefined when there is no trailing data past the image', () => {
			// Buffer length equals the segment image end, so nothing to strip.
			const bytes = buildMachO([{ cmd: LC_SEGMENT_64, fileoff: 0, filesize: 200 }], 200);
			assert.strictEqual(stripMachOTrailingData(bytes), undefined);
		});

		test('returns undefined when no LC_SEGMENT_64 load command is present', () => {
			const bytes = buildMachO([{ cmd: LC_UUID }], 256);
			assert.strictEqual(stripMachOTrailingData(bytes), undefined);
		});

		test('returns undefined for a non-Mach-O (wrong magic) buffer', () => {
			const bytes = buildMachO([{ cmd: LC_SEGMENT_64, fileoff: 0, filesize: 200 }], 256, 0xcafebabe);
			assert.strictEqual(stripMachOTrailingData(bytes), undefined);
		});

		test('returns undefined for a buffer too short to be a Mach-O header', () => {
			assert.strictEqual(stripMachOTrailingData(Buffer.alloc(16)), undefined);
		});
	});

	suite('verifyExtensionHash', () => {
		const bytes = Buffer.from('the duckdb excel extension bytes');
		const matchingHash = crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

		test('does not throw when the hash matches the pin', () => {
			assert.doesNotThrow(() => verifyExtensionHash(bytes, matchingHash, 'osx_arm64'));
		});

		test('throws naming the platform when the hash does not match', () => {
			assert.throws(
				() => verifyExtensionHash(bytes, 'deadbeef', 'osx_arm64'),
				/SHA-256 mismatch.*osx_arm64/s
			);
		});

		test('throws with the print-excel-hashes hint when no pin exists', () => {
			assert.throws(
				() => verifyExtensionHash(bytes, undefined, 'linux_amd64'),
				/Missing positron\.duckdbExcelExtensionHashes\.linux_amd64.*print-excel-hashes/s
			);
		});
	});
});
