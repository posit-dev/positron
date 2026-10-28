/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import type * as estree from 'estree';

const HEAVY_PRESET = /^with(Workbench|Notebook|NotebookEditor|React|Contribution)Services$/;

/**
 * Flags a Vitest file that imports positronTestContainer.js without using one
 * of its heavy presets. That module loads the Notebook and Workbench presets
 * (~7s of import per file); Bare and Runtime tests should import
 * createLightTestContainer() from lightTestContainer.js instead.
 */
export default new class VitestLightTestContainer implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		type: 'problem',
		messages: {
			useLight: 'This file uses no heavy preset (Workbench, Notebook, NotebookEditor, React, Contribution). ' +
				'Use createLightTestContainer() from lightTestContainer.js; positronTestContainer.js adds ~7s of import per file.',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		const imports: estree.ImportDeclaration[] = [];
		let usesHeavyPreset = false;

		return {
			ImportDeclaration: (node: estree.ImportDeclaration) => {
				if (typeof node.source.value === 'string' && node.source.value.endsWith('/positronTestContainer.js')) {
					imports.push(node);
				}
			},
			['CallExpression > MemberExpression.callee > Identifier.property']: (node: estree.Identifier) => {
				if (HEAVY_PRESET.test(node.name)) {
					usesHeavyPreset = true;
				}
			},
			'Program:exit': () => {
				if (!usesHeavyPreset) {
					for (const node of imports) {
						context.report({ node, messageId: 'useLight' });
					}
				}
			},
		};
	}
};
