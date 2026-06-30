/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ContextKeyExpression, IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { AskAssistantAction } from '../../browser/AskAssistantAction.js';

/**
 * The Ask Assistant action is gated on the composite notebook AI context key
 * (`positronNotebook.aiEnabled`), which is on only when both the global
 * `ai.enabled` and the notebooks-only `notebook.ai.enabled` are on. That
 * config->key composition is verified in `notebookAIEnabledContextKey.vitest.ts`;
 * here we assert the action reads the key. The menu `when` clause hides the
 * editor toolbar button, but the action also sets `f1: true`, so it gets a
 * command palette entry whose visibility is driven by the `precondition`.
 *
 * These tests evaluate the real expressions against contexts rather than
 * string-matching the serialized form, so an inverted (`not`) gate (which would
 * still contain the key substring) is caught.
 */
describe('AskAssistantAction', () => {
	const desc = new AskAssistantAction().desc;
	const AI_ENABLED = NotebookContextKeys.aiEnabled.key;

	// Minimal IContext backed by a plain map of context-key -> value.
	function evaluate(expr: ContextKeyExpression | undefined, values: Record<string, unknown>): boolean {
		expect(expr).toBeDefined();
		const context: IContext = {
			getValue: (key: string) => values[key] as never,
		};
		return expr!.evaluate(context);
	}

	describe('precondition (command palette entry + execution)', () => {
		it('is enabled when the notebook AI gate is on', () => {
			expect(evaluate(desc.precondition, { [AI_ENABLED]: true })).toBe(true);
		});

		it('is disabled when the notebook AI gate is off', () => {
			expect(evaluate(desc.precondition, { [AI_ENABLED]: false })).toBe(false);
		});
	});

	describe('menu when clause (editor toolbar button)', () => {
		const menu = Array.isArray(desc.menu) ? desc.menu[0] : desc.menu;
		const activeNotebook = { 'activeEditor': POSITRON_NOTEBOOK_EDITOR_ID };

		it('is shown when the notebook AI gate is on in the notebook editor', () => {
			expect(evaluate(menu?.when, { ...activeNotebook, [AI_ENABLED]: true })).toBe(true);
		});

		it('is hidden when the notebook AI gate is off', () => {
			expect(evaluate(menu?.when, { ...activeNotebook, [AI_ENABLED]: false })).toBe(false);
		});

		it('is hidden outside the notebook editor even when the gate is on', () => {
			expect(evaluate(menu?.when, { 'activeEditor': 'other.editor', [AI_ENABLED]: true })).toBe(false);
		});
	});
});
