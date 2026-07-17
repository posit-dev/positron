/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The mode a prompt fragment applies to (a chat mode or agent location, e.g.
 * `agent`, `ask`, `edit`, `editor`, `notebook`, `terminal`).
 */
export type PromptMetadataMode = string;

/**
 * Data made available to prompt templates under the `positron.` namespace.
 */
export interface PromptRenderData {
	/** The chat request, exposing only the fields templates reference. */
	request?: { location2?: { selection?: { isEmpty?: boolean } } };
	/** Active runtime sessions, used to derive language availability. */
	sessions?: Array<{ languageId: string }>;
	/** Whether streaming edits are enabled. */
	streamingEdits?: boolean;
	/** The current chat mode. */
	mode?: PromptMetadataMode;
}

/** Helper properties computed for template conditions. */
interface AugmentedRenderData extends PromptRenderData {
	hasRSession: boolean;
	hasPythonSession: boolean;
}

/**
 * A minimal template engine supporting `{{@if(...)}} ... {{#else}} ... {{/if}}`
 * conditionals and `{{expression}}` interpolation. Expressions are literals or
 * property paths rooted at `positron.` (e.g. `positron.hasRSession`).
 *
 * Ported from the Positron Assistant extension so the same prompt templates can
 * be rendered in core.
 */
export class PromptTemplateEngine {

	/** Augment render data with helper properties for template conditions. */
	private static augmentRenderData(data: PromptRenderData): AugmentedRenderData {
		const hasRSession = data.sessions?.some(s => s.languageId === 'r') ?? false;
		const hasPythonSession = data.sessions?.some(s => s.languageId === 'python') ?? false;
		return { ...data, hasRSession, hasPythonSession };
	}

	/** Resolve a string/boolean literal or a `positron.`-rooted property path. */
	private static resolveValue(expr: string, data: AugmentedRenderData): unknown {
		const trimmed = expr.trim();

		// String literals.
		if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith(`'`) && trimmed.endsWith(`'`))) {
			return trimmed.slice(1, -1);
		}

		// Boolean literals.
		if (trimmed === 'true') {
			return true;
		}
		if (trimmed === 'false') {
			return false;
		}

		// Property paths starting with 'positron.'.
		if (trimmed.startsWith('positron.')) {
			const propertyPath = trimmed.slice('positron.'.length);
			return propertyPath.split('.').reduce<unknown>(
				(obj, key) => (obj as Record<string, unknown> | undefined)?.[key],
				data);
		}

		return undefined;
	}

	/** Resolve a property path or expression, supporting `==`, `!=` and `!`. */
	private static resolveProperty(path: string, data: AugmentedRenderData): unknown {
		let trimmed = path.trim();

		// Strip outer parentheses if present.
		if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
			trimmed = trimmed.slice(1, -1).trim();
		}

		// Inequality comparison.
		if (trimmed.includes('!=')) {
			const separator = trimmed.includes('!==') ? '!==' : '!=';
			const parts = trimmed.split(separator);
			if (parts.length === 2) {
				return PromptTemplateEngine.resolveValue(parts[0], data) !== PromptTemplateEngine.resolveValue(parts[1], data);
			}
		}

		// Equality comparison.
		if (trimmed.includes('==')) {
			const separator = trimmed.includes('===') ? '===' : '==';
			const parts = trimmed.split(separator);
			if (parts.length === 2) {
				return PromptTemplateEngine.resolveValue(parts[0], data) === PromptTemplateEngine.resolveValue(parts[1], data);
			}
		}

		// Negation.
		if (trimmed.startsWith('!')) {
			return !PromptTemplateEngine.resolveProperty(trimmed.slice(1), data);
		}

		return PromptTemplateEngine.resolveValue(trimmed, data);
	}

	/** Render a template against the given data. */
	static render(template: string, data: PromptRenderData): string {
		const augmentedData = PromptTemplateEngine.augmentRenderData(data);
		let pos = 0;
		let result = '';

		while (pos < template.length) {
			const tagStart = template.indexOf('{{', pos);
			if (tagStart === -1) {
				result += template.slice(pos);
				break;
			}

			result += template.slice(pos, tagStart);

			if (template.startsWith('{{@if(', tagStart)) {
				// Conditional tag.
				const conditionStart = tagStart + '{{@if('.length;
				const conditionEnd = template.indexOf(')', conditionStart);
				if (conditionEnd === -1) {
					result += template.slice(tagStart);
					break;
				}

				const condition = template.slice(conditionStart, conditionEnd);
				const blockStart = conditionEnd + ')}}'.length;

				// Find the matching {{/if}} using depth tracking.
				let depth = 1;
				let elsePos = -1;
				let i = blockStart;

				while (i < template.length && depth > 0) {
					if (template.startsWith('{{@if(', i)) {
						depth++;
						i += '{{@if('.length;
					} else if (template.startsWith('{{#else}}', i)) {
						if (depth === 1 && elsePos === -1) {
							elsePos = i;
						}
						i += '{{#else}}'.length;
					} else if (template.startsWith('{{/if}}', i)) {
						depth--;
						if (depth === 0) {
							const ifBlock = elsePos === -1
								? template.slice(blockStart, i)
								: template.slice(blockStart, elsePos);
							const elseBlock = elsePos === -1
								? ''
								: template.slice(elsePos + '{{#else}}'.length, i);

							const conditionValue = PromptTemplateEngine.resolveProperty(condition, augmentedData);
							const chosenBlock = conditionValue ? ifBlock : elseBlock;
							result += PromptTemplateEngine.render(chosenBlock, data);

							pos = i + '{{/if}}'.length;
							break;
						}
						i += '{{/if}}'.length;
					} else {
						i++;
					}
				}

				if (depth > 0) {
					result += template.slice(tagStart);
					break;
				}
			} else if (template.startsWith('{{', tagStart) && !template.startsWith('{{#else}}', tagStart) && !template.startsWith('{{/if}}', tagStart)) {
				// Interpolation tag.
				const tagEnd = template.indexOf('}}', tagStart + 2);
				if (tagEnd === -1) {
					result += template.slice(tagStart);
					break;
				}

				const expression = template.slice(tagStart + 2, tagEnd);
				const value = PromptTemplateEngine.resolveProperty(expression, augmentedData);
				result += value !== undefined && value !== null ? String(value) : '';
				pos = tagEnd + '}}'.length;
			} else {
				// Unexpected tag ({{#else}} or {{/if}} without a matching {{@if).
				result += template.slice(tagStart, tagStart + 2);
				pos = tagStart + 2;
			}
		}

		return result;
	}
}
