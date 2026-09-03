/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Expands the mechanical facts of a command (its argument shapes and return
 * value) into a skill template, leaving the surrounding hand-written guidance
 * untouched. The facts come from live command metadata, so they are never
 * hand-copied and cannot drift from the code.
 *
 * A template carries three kinds of directive:
 *
 *   {{command:some.command.id}}   -> renders the command's Arguments and
 *                                    Returns sections, labels included.
 *
 *   {{#if flag}}...{{else}}...{{/if}}   -> Conditional blocks. The first body
 *   {{#if !flag}}...{{/if}}                is kept when the condition holds,
 *                                          the optional `{{else}}` body when it
 *                                          does not. `!` negates. Flags are
 *                                          facts known at generation time --
 *                                          the environment (e.g. `pwb` for
 *                                          Posit Workbench) or what the
 *                                          installed extensions publish (e.g.
 *                                          `shiny_agent_metadata`) -- so the
 *                                          emitted text is assertive rather
 *                                          than conditional.
 *
 *   {{some_value}}   -> replaced with the caller-provided string for that name
 *                       (e.g. `skill_dir`, `remote_authority`). A name the
 *                       caller does not provide is left verbatim -- it may be
 *                       literal example text -- and reported as drift.
 *
 * Everything else in the template -- the when-to-use prose, the caveats the
 * metadata gets wrong -- is authored by hand and passes through verbatim.
 *
 * The language is deliberately this weak: directives are flat literal tokens
 * with no expressions, arguments, or nesting. Tests depend on that -- the
 * drift test regexes command ids straight out of the raw markdown, and the
 * metadata test expands descriptions under every flag combination, both
 * possible only because directives are statically enumerable. Extend it by
 * adding a namespaced directive (like `command:`), not by adding syntax; if a
 * need ever outgrows that, switch to a mature engine or templates-as-code
 * rather than growing an expression grammar here.
 */

/** Minimal view of a JSON Schema; only the parts we render are typed. */
interface JsonSchema {
	readonly type?: string | string[];
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly items?: JsonSchema;
	readonly enum?: readonly unknown[];
}

/** A positional argument accepted by a command. Mirrors `positron.ai.AgentCommandArg`. */
export interface AgentCommandArg {
	readonly name: string;
	readonly description?: string;
	readonly schema?: object;
	readonly required?: boolean;
}

/** Command metadata needed to render a template. Mirrors `positron.ai.AgentCommand`. */
export interface AgentCommand {
	readonly id: string;
	readonly args?: readonly AgentCommandArg[];
	readonly returns?: string;
}

/**
 * Generation-time facts controlling conditional blocks, e.g. `{ pwb: true }`.
 * A flag a template names but the caller does not provide counts as false and
 * is reported in {@link ExpandResult.unknownFlags}.
 */
export type TemplateFlags = Readonly<Record<string, boolean>>;

/**
 * Environment strings substituted for `{{name}}` directives, e.g.
 * `{ remote_authority: 'localhost:8787' }`. A name a template uses but the
 * caller does not provide is left verbatim in the output and reported in
 * {@link ExpandResult.unknownValues}.
 */
export type TemplateValues = Readonly<Record<string, string>>;

export interface ExpandResult {
	/** The template with every directive replaced. */
	readonly text: string;
	/** Command ids named by a directive that were absent from the metadata. */
	readonly unresolved: readonly string[];
	/** Flag names used in conditional blocks that the caller did not provide. */
	readonly unknownFlags: readonly string[];
	/** Conditional markers with no matching opener/closer, left out of the output. */
	readonly unbalanced: readonly string[];
	/**
	 * `{{#if}}` openers that name a flag an enclosing block already tests.
	 * Nesting a flag inside itself is either redundant (same polarity) or dead
	 * text (opposite polarity), so it is always an authoring error. The block
	 * still resolves by its stated condition.
	 */
	readonly sameFlagNesting: readonly string[];
	/**
	 * `{{name}}` value directives whose name the caller did not provide,
	 * anywhere in the template (dropped branches included -- an unknown name is
	 * authoring drift wherever it sits). Each is left verbatim in the output.
	 */
	readonly unknownValues: readonly string[];
}

/** Matches `{{command:ID}}`, capturing the id. */
const DIRECTIVE = /\{\{command:([^}]+)\}\}/g;

/** Matches every conditional marker: `{{#if !?flag}}`, `{{else}}`, or `{{/if}}`. */
const CONDITIONAL_TOKEN = /\{\{#if (?<negation>!?)(?<flag>[A-Za-z][\w-]*)\}\}|\{\{else\}\}|\{\{\/if\}\}/g;

/**
 * Matches a `{{name}}` value directive. Names are snake_case identifiers, so
 * the other directive shapes can never match: `{{command:id}}` has a colon,
 * `{{#if flag}}` a hash, `{{/if}}` a slash. `{{else}}` does match and is
 * excluded by name where this pattern is used.
 */
const VALUE_DIRECTIVE = /\{\{(?<name>[a-z][a-z0-9_]*)\}\}/g;

/**
 * A compact, faithful type description for a schema, e.g. `boolean`,
 * `object { preserveFocus?: boolean }`, `array of string`. Object properties
 * are expanded one level so inner optionality is visible -- this is what
 * corrects the common case where an object argument is flagged required even
 * though every property inside it is optional.
 */
function describeSchema(schema: object | undefined): string {
	if (!schema) {
		return 'value';
	}
	const s = schema as JsonSchema;
	if (s.enum) {
		return s.enum.map(v => JSON.stringify(v)).join(' | ');
	}
	const type = Array.isArray(s.type) ? s.type.join(' | ') : s.type;
	if (type === 'object' && s.properties) {
		const required = new Set(s.required ?? []);
		const props = Object.entries(s.properties).map(
			([key, value]) => `${key}${required.has(key) ? '' : '?'}: ${describeSchema(value)}`,
		);
		return props.length ? `object { ${props.join(', ')} }` : 'object';
	}
	if (type === 'array' && s.items) {
		return `array of ${describeSchema(s.items)}`;
	}
	return type ?? 'value';
}

function renderArgs(command: AgentCommand): string {
	if (!command.args?.length) {
		return 'None.';
	}
	return command.args
		.map(arg => {
			const optional = arg.required === false ? ', optional' : '';
			const description = arg.description ? `: ${arg.description}` : '';
			return `- \`${arg.name}\` (${describeSchema(arg.schema)}${optional})${description}`;
		})
		.join('\n');
}

function renderReturns(command: AgentCommand): string {
	return command.returns?.trim() || 'None.';
}

/**
 * Render the Arguments and Returns sections for a command. Returns is always a
 * single line, so its label sits inline; the argument list is multi-line when
 * present, so its label gets its own line to avoid gluing the first bullet to
 * the label.
 */
function renderCommand(command: AgentCommand): string {
	const args = command.args?.length
		? `**Arguments:**\n${renderArgs(command)}`
		: '**Arguments:** None.';
	return `${args}\n\n**Returns:** ${renderReturns(command)}`;
}

/** An open `{{#if}}` block while scanning. */
interface ConditionalFrame {
	/** The flag the block tests. */
	readonly flag: string;
	/** The opener's literal marker text, for reporting it as unterminated. */
	readonly marker: string;
	/** The condition's value, negation already applied. */
	readonly condition: boolean;
	/** Whether the block's `{{else}}` has been passed. */
	seenElse: boolean;
}

/** Whether the frame's current branch (before or after `{{else}}`) is kept. */
function frameKeeps(frame: ConditionalFrame): boolean {
	return frame.seenElse ? !frame.condition : frame.condition;
}

/**
 * Resolve every conditional block against `flags` in a single scan: text is
 * emitted only while every enclosing block's active branch is kept. A stack
 * pairs each `{{/if}}` with its own opener, so nesting -- including a flag
 * nested inside itself -- always resolves by block structure, never by
 * marker-counting shortcuts.
 *
 * Malformed markers never leak into the output and are always reported:
 * an unterminated opener has its condition honored to the end of the input,
 * and an orphan `{{else}}` or `{{/if}}` (or a second `{{else}}` in one block)
 * is dropped with no effect on the surrounding text.
 *
 * Removing a marker or a dropped branch that sat on its own lines leaves
 * stacked blank lines behind; the run of newlines at each removal seam is
 * capped at two (one blank line). Only seams are touched -- text the template
 * carries verbatim, such as blank lines inside a fenced code example, is
 * never rewritten.
 */
function resolveConditionals(
	template: string,
	flags: TemplateFlags,
	unknownFlags: Set<string>,
	unbalanced: Set<string>,
	sameFlagNesting: Set<string>,
): string {
	const stack: ConditionalFrame[] = [];
	const emitting = () => stack.every(frameKeeps);
	let text = '';
	let last = 0;
	// Emit a verbatim segment. The first segment after a removal (a marker or
	// a dropped branch) starts at a seam: cap the newline run straddling it at
	// two, trimming only the newlines the segment leads with -- never text
	// already emitted, whose newlines the template carried verbatim.
	let atSeam = false;
	const emit = (segment: string) => {
		if (atSeam) {
			const trailing = /\n*$/.exec(text)![0].length;
			const leading = /^\n*/.exec(segment)![0].length;
			const excess = trailing + leading - 2;
			if (excess > 0) {
				segment = segment.slice(Math.min(leading, excess));
			}
			atSeam = false;
		}
		text += segment;
	};
	for (const match of template.matchAll(CONDITIONAL_TOKEN)) {
		// The text between the previous marker and this one belongs to the
		// branch state that was in force there.
		if (emitting()) {
			emit(template.slice(last, match.index));
		}
		last = match.index + match[0].length;
		atSeam = true;
		const flag = match.groups?.flag;
		if (flag !== undefined) {
			// `{{#if !?flag}}`. Flag facts are recorded even inside a dropped
			// branch: an unknown flag is authoring drift wherever it sits.
			if (!Object.hasOwn(flags, flag)) {
				unknownFlags.add(flag);
			}
			if (stack.some(frame => frame.flag === flag)) {
				sameFlagNesting.add(match[0]);
			}
			const value = flags[flag] === true;
			stack.push({
				flag,
				marker: match[0],
				condition: match.groups?.negation === '!' ? !value : value,
				seenElse: false,
			});
		} else if (match[0] === '{{else}}') {
			const top = stack.at(-1);
			if (!top || top.seenElse) {
				unbalanced.add('{{else}}');
			} else {
				top.seenElse = true;
			}
		} else {
			// `{{/if}}`.
			if (!stack.pop()) {
				unbalanced.add('{{/if}}');
			}
		}
	}
	if (emitting()) {
		emit(template.slice(last));
	}
	for (const frame of stack) {
		unbalanced.add(frame.marker);
	}
	return text;
}

/**
 * Replace every directive in `template` with facts from `commandsById`, after
 * resolving conditional blocks against `flags` and substituting `values`. An
 * id with no matching command degrades to an empty section (never a leaked
 * `{{...}}`) and is reported in {@link ExpandResult.unresolved} so the caller
 * can treat it as drift.
 */
export function expandTemplate(
	template: string,
	commandsById: ReadonlyMap<string, AgentCommand>,
	flags: TemplateFlags = {},
	values: TemplateValues = {},
): ExpandResult {
	const unresolved = new Set<string>();
	const unknownFlags = new Set<string>();
	const unbalanced = new Set<string>();
	const sameFlagNesting = new Set<string>();
	const unknownValues = new Set<string>();
	// Unknown value names are recorded even inside a dropped branch, like flag
	// facts: an unknown name is authoring drift wherever it sits, and the branch
	// that hides it here is exactly the one kept in the other environment.
	for (const match of template.matchAll(VALUE_DIRECTIVE)) {
		const name = match.groups!.name;
		if (name !== 'else' && !Object.hasOwn(values, name)) {
			unknownValues.add(name);
		}
	}
	// Conditionals resolve first so a dropped block's command directives are
	// never expanded (or counted as drift) in an environment that excludes them.
	const conditioned = resolveConditionals(template, flags, unknownFlags, unbalanced, sameFlagNesting);
	const text = conditioned
		.replace(DIRECTIVE, (_match, rawId: string) => {
			const id = rawId.trim();
			const command = commandsById.get(id);
			if (!command) {
				unresolved.add(id);
				return renderCommand({ id });
			}
			return renderCommand(command);
		})
		// Unknown names stay verbatim: unlike the other directives, a bare
		// `{{name}}` can be literal example text the template carries on
		// purpose, and mangling that is worse than the (reported) leak.
		.replace(VALUE_DIRECTIVE, (match, name: string) =>
			Object.hasOwn(values, name) ? values[name] : match,
		);
	return {
		text,
		unresolved: [...unresolved],
		unknownFlags: [...unknownFlags],
		unbalanced: [...unbalanced],
		sameFlagNesting: [...sameFlagNesting],
		unknownValues: [...unknownValues],
	};
}
