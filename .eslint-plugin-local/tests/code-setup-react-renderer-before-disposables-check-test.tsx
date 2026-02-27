/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Test file to verify the code-setup-react-renderer-before-disposables-check ESLint rule.

import { setupReactRenderer } from '../../src/vs/base/test/browser/react.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../src/vs/base/test/common/utils.js';

// -----
// Valid
// -----

suite('correct order - destructured', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();
});

suite('correct order - expression statement', () => {
	setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();
});

suite('correct order - ensureNoDisposables assigned to variable', () => {
	setupReactRenderer();
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
});

suite('only setupReactRenderer - no ensureNoDisposables', () => {
	setupReactRenderer();
});

suite('only ensureNoDisposables - no setupReactRenderer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
});

suite('neither function present', () => {
});

// -------
// Invalid
// -------

suite('wrong order - destructured', () => {
	// eslint-disable-next-line local/code-setup-react-renderer-before-disposables-check
	ensureNoDisposablesAreLeakedInTestSuite();
	const { render } = setupReactRenderer();
});

suite('wrong order - expression statement', () => {
	// eslint-disable-next-line local/code-setup-react-renderer-before-disposables-check
	ensureNoDisposablesAreLeakedInTestSuite();
	setupReactRenderer();
});

suite('wrong order - ensureNoDisposables assigned to variable', () => {
	// eslint-disable-next-line local/code-setup-react-renderer-before-disposables-check
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	setupReactRenderer();
});
