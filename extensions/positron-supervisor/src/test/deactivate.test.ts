/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { shouldDisposeOnDeactivate } from '../extension';

suite('shouldDisposeOnDeactivate', () => {
	test('disposes on desktop Quit', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Quit, vscode.UIKind.Desktop),
			true,
		);
	});

	test('does not dispose on web Quit', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Quit, vscode.UIKind.Web),
			false,
		);
	});

	test('does not dispose on desktop Reload', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Reload, vscode.UIKind.Desktop),
			false,
		);
	});

	test('does not dispose on web Reload', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Reload, vscode.UIKind.Web),
			false,
		);
	});

	test('does not dispose on desktop Close', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Close, vscode.UIKind.Desktop),
			false,
		);
	});

	test('does not dispose on desktop Load', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Load, vscode.UIKind.Desktop),
			false,
		);
	});

	test('does not dispose on web Close', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Close, vscode.UIKind.Web),
			false,
		);
	});

	test('does not dispose on web Load', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(positron.ShutdownReason.Load, vscode.UIKind.Web),
			false,
		);
	});

	test('does not dispose when the shutdown reason is unknown (desktop)', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(undefined, vscode.UIKind.Desktop),
			false,
		);
	});

	test('does not dispose when the shutdown reason is unknown (web)', () => {
		assert.strictEqual(
			shouldDisposeOnDeactivate(undefined, vscode.UIKind.Web),
			false,
		);
	});
});
