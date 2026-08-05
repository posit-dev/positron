/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sniffMachOBinaryArchitecture } from '../kernel';

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

/** Writes a minimal thin 64-bit Mach-O header (little-endian) for the given cputype. */
function writeThinMachO(cpuType: number): string {
	const buf = Buffer.alloc(32);
	buf.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
	buf.writeUInt32LE(cpuType >>> 0, 4); // cputype
	return writeTempBinary(buf);
}

/** Writes a minimal universal (fat) Mach-O header (big-endian) for the given cputypes. */
function writeFatMachO(cpuTypes: number[]): string {
	const buf = Buffer.alloc(8 + cpuTypes.length * 20);
	buf.writeUInt32BE(0xcafebabe, 0); // FAT_MAGIC
	buf.writeUInt32BE(cpuTypes.length, 4); // nfat_arch
	cpuTypes.forEach((cpuType, i) => {
		buf.writeUInt32BE(cpuType >>> 0, 8 + i * 20); // fat_arch.cputype
	});
	return writeTempBinary(buf);
}

const tempFiles: string[] = [];

function writeTempBinary(buf: Buffer): string {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'macho-')), 'exec');
	fs.writeFileSync(file, buf);
	tempFiles.push(file);
	return file;
}

suite('sniffMachOBinaryArchitecture', () => {

	suiteTeardown(() => {
		for (const file of tempFiles) {
			fs.rmSync(path.dirname(file), { recursive: true, force: true });
		}
	});

	test('thin arm64 binary', () => {
		assert.strictEqual(sniffMachOBinaryArchitecture(writeThinMachO(CPU_TYPE_ARM64)), 'arm64');
	});

	test('thin x86_64 binary', () => {
		assert.strictEqual(sniffMachOBinaryArchitecture(writeThinMachO(CPU_TYPE_X86_64)), 'x86_64');
	});

	test('universal binary prefers the host architecture', () => {
		const arch = sniffMachOBinaryArchitecture(writeFatMachO([CPU_TYPE_X86_64, CPU_TYPE_ARM64]));
		const expected = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : undefined;
		assert.strictEqual(arch, expected);
	});

	test('single-slice universal binary returns that slice', () => {
		// A fat binary whose only slice does not match the host still resolves.
		const otherArch = process.arch === 'arm64' ? CPU_TYPE_X86_64 : CPU_TYPE_ARM64;
		const expected = otherArch === CPU_TYPE_ARM64 ? 'arm64' : 'x86_64';
		assert.strictEqual(sniffMachOBinaryArchitecture(writeFatMachO([otherArch])), expected);
	});

	test('undefined and missing paths return undefined', () => {
		assert.strictEqual(sniffMachOBinaryArchitecture(undefined), undefined);
		assert.strictEqual(sniffMachOBinaryArchitecture('/nonexistent/exec/R'), undefined);
	});

	test('unrecognized header returns undefined', () => {
		assert.strictEqual(sniffMachOBinaryArchitecture(writeTempBinary(Buffer.alloc(64))), undefined);
	});
});
