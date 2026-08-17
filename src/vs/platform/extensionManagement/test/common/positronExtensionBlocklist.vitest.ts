/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isUnsatisfiableDependency, POSITRON_BLOCKED_EXTENSIONS, POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN } from '../../common/positronExtensionBlocklist.js';

describe('positronExtensionBlocklist', () => {

	it('should treat dependencies on blocked extensions Positron ships as built-ins as satisfiable', () => {
		// ruff 2026.62.0 depends on ms-python.python; Positron provides it in-tree
		expect(isUnsatisfiableDependency('ms-python.python')).toBe(false);
		expect(isUnsatisfiableDependency('GitHub.copilot-chat')).toBe(false);
	});

	it('should treat dependencies on blocked extensions without a built-in as unsatisfiable', () => {
		// ruff 2026.64.0 depends on ms-python.vscode-python-envs; nothing in Positron provides it (#15118)
		expect(isUnsatisfiableDependency('ms-python.vscode-python-envs')).toBe(true);
		expect(isUnsatisfiableDependency('reditorsupport.r')).toBe(true);
	});

	it('should treat non-blocked dependencies as satisfiable', () => {
		expect(isUnsatisfiableDependency('ms-toolsai.jupyter')).toBe(false);
	});

	it('should keep the built-in carve-out list a subset of the blocklist', () => {
		expect(POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN.every(id => POSITRON_BLOCKED_EXTENSIONS.includes(id))).toBe(true);
	});

	it('should keep every blocklist entry lower case', () => {
		expect(POSITRON_BLOCKED_EXTENSIONS.filter(id => id !== id.toLowerCase())).toEqual([]);
		expect(POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN.filter(id => id !== id.toLowerCase())).toEqual([]);
	});

});
