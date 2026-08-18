/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Merge guard for the vendored Windows update helper.
 *
 * `build/win32/inno_updater.exe` is a prebuilt binary from
 * https://github.com/posit-dev/positron-inno-updater (a rebranded copy of
 * microsoft/inno-updater). Upstream VS Code vendors its own unbranded build
 * at the same path, so an upstream merge can silently replace ours. That has
 * happened twice (#7769, #13572); see #15330.
 *
 * The regression is user-visible in two ways: failure dialogs say
 * "Visual Studio Code" instead of "Positron", and the update log is written
 * as vscode-inno-updater-*.log, so users cannot find the log we ask for.
 *
 * These assertions scan the binary for the string literals that the
 * rebranded source compiles in. If this test fails after an upstream merge,
 * do not delete it: rebuild the binary from posit-dev/positron-inno-updater
 * (its Build workflow produces the exe) and vendor that instead.
 */
describe('inno_updater.exe branding (#15330)', () => {
	const exePath = path.join(import.meta.dirname, '..', 'build', 'win32', 'inno_updater.exe');
	const exe = fs.readFileSync(exePath);
	// Rust string literals are stored as UTF-8; for the ASCII strings we
	// check, a latin1 decode finds them byte-for-byte.
	const ascii = exe.toString('latin1');

	it('writes its log as positron-inno-updater-*.log', () => {
		expect(ascii).toContain('positron-inno-updater-');
		expect(ascii).not.toContain('vscode-inno-updater-');
	});

	it('shows Positron, not VS Code, in failure dialogs', () => {
		expect(ascii).toContain('Failed to install Positron update.');
		expect(ascii).not.toContain('Failed to install Visual Studio Code update.');
		expect(ascii).toContain('Positron is updating...');
	});

	it('carries Positron branding in the version resource', () => {
		// Resource-section strings (dialog caption, VERSIONINFO) are UTF-16LE.
		expect(exe.includes(Buffer.from('Updating Positron...', 'utf16le'))).toBe(true);
		expect(exe.includes(Buffer.from('Updating Visual Studio Code...', 'utf16le'))).toBe(false);
	});
});
