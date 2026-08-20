/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { isSessionVisibleFile } from '../../common/importDataFileUri.js';

describe('isSessionVisibleFile', () => {
	describe('in a local window', () => {
		it('accepts a local file', () => {
			expect(isSessionVisibleFile(URI.file('/Users/austin/flights.csv'), undefined)).toBe(true);
		});

		it('rejects a virtual filesystem', () => {
			expect(isSessionVisibleFile(URI.parse('vscode-vfs://github/posit-dev/positron/flights.csv'), undefined)).toBe(false);
		});

		it('rejects a remote file, which no local session can read', () => {
			expect(isSessionVisibleFile(URI.parse('vscode-remote://ssh-remote%2Bhost/home/austin/flights.csv'), undefined)).toBe(false);
		});
	});

	// Every remote flavor presents its files the same way, as `vscode-remote` under the window's own
	// authority, so the same expectations have to hold for each of them. Only Remote SSH has been
	// exercised by hand; these keep the check from quietly growing an SSH-shaped assumption.
	describe.each([
		{ flavor: 'Remote SSH', authority: 'ssh-remote+host', path: '/home/austin/flights.csv' },
		{ flavor: 'WSL', authority: 'wsl+Ubuntu', path: '/home/austin/flights.csv' },
		{ flavor: 'WSL, reading the Windows drive it mounts', authority: 'wsl+Ubuntu', path: '/mnt/c/Users/austin/flights.csv' },
		{ flavor: 'a dev container', authority: 'dev-container+7b22686f7374', path: '/workspaces/positron/flights.csv' },
		{ flavor: 'an attached container', authority: 'attached-container+7b226e616d65', path: '/data/flights.csv' },
		{ flavor: 'a remote server reached from the browser', authority: 'localhost:8080', path: '/home/austin/flights.csv' },
	])('in a $flavor window', ({ authority, path }) => {
		/** The file as it appears in this window, e.g. `vscode-remote://wsl%2BUbuntu/home/austin/x.csv`. */
		const fileUri = URI.from({ scheme: 'vscode-remote', authority, path });

		it('accepts a file on the window own remote', () => {
			expect(isSessionVisibleFile(fileUri, authority)).toBe(true);
		});

		it('ignores authority casing, which the URI may have normalized', () => {
			expect(isSessionVisibleFile(fileUri.with({ authority: authority.toUpperCase() }), authority)).toBe(true);
		});

		it('survives the round trip through toString and parse the backing URI makes', () => {
			expect(isSessionVisibleFile(URI.parse(fileUri.toString()), authority)).toBe(true);
		});

		it('rejects a file on a different remote of the same kind', () => {
			expect(isSessionVisibleFile(fileUri.with({ authority: `${authority}-other` }), authority)).toBe(false);
		});

		it('rejects a client-local file, which the remote session cannot read', () => {
			expect(isSessionVisibleFile(URI.file('/Users/austin/flights.csv'), authority)).toBe(false);
		});

		it('rejects a virtual filesystem', () => {
			expect(isSessionVisibleFile(URI.parse('vscode-vfs://github/posit-dev/positron/flights.csv'), authority)).toBe(false);
		});
	});
});
