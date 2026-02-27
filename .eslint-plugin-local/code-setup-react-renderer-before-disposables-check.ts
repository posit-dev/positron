/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import type * as estree from 'estree';
import { TSESTree } from '@typescript-eslint/utils';

export default new class SetupReactRendererBeforeDisposablesCheck implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		type: 'problem',
		messages: {
			order: '`setupReactRenderer()` must be called before `ensureNoDisposablesAreLeakedInTestSuite()`. ' +
				'Mocha runs teardown hooks in FIFO order, so the React teardown must register first to unmount ' +
				'components and dispose VS Code disposables before the leak checker inspects them.',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return {
			// Match setupReactRenderer() as a direct statement (expression or variable declaration) inside a suite callback.
			['CallExpression[callee.name="suite"] > :function > BlockStatement > :matches(ExpressionStatement, VariableDeclaration) CallExpression[callee.name="setupReactRenderer"]']: (node: estree.CallExpression) => {
				// Walk up to the BlockStatement to find sibling statements.
				let stmt = node as TSESTree.Node;
				while (stmt.parent && stmt.parent.type !== 'BlockStatement') {
					stmt = stmt.parent;
				}
				const block = stmt.parent as TSESTree.BlockStatement;
				const setupIdx = block.body.indexOf(stmt as TSESTree.Statement);

				// Scan backward: if ensureNoDisposablesAreLeakedInTestSuite appears earlier, report it.
				for (let i = setupIdx - 1; i >= 0; i--) {
					if (isCallInStatement(block.body[i], 'ensureNoDisposablesAreLeakedInTestSuite')) {
						context.report({ node: block.body[i] as estree.Node, messageId: 'order' });
						return;
					}
				}
			},
		};
	}
};

/** Check whether a statement contains a call to the given function name. */
function isCallInStatement(node: TSESTree.Statement, name: string): boolean {
	if (node.type === 'ExpressionStatement') {
		return isCallTo(node.expression, name);
	}
	if (node.type === 'VariableDeclaration') {
		return node.declarations.some(d => d.init && isCallTo(d.init, name));
	}
	return false;
}

function isCallTo(node: TSESTree.Expression, name: string): boolean {
	return node.type === 'CallExpression'
		&& node.callee.type === 'Identifier'
		&& node.callee.name === name;
}
