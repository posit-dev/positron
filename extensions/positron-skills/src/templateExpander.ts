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
 * A template carries one directive, naming a command id:
 *   {{command:some.command.id}}   -> renders the command's Arguments and
 *                                    Returns sections, labels included.
 *
 * Guidance that only applies in some environments sits in a block, with each
 * marker on its own line:
 *   {{if:web}}
 *   ...                           -> kept only when the `web` flag is set.
 *   {{endif}}
 * Blocks don't nest and have no `else` or negation.
 *
 * Everything else in the template -- the when-to-use prose, the caveats the
 * metadata gets wrong -- is authored by hand and passes through verbatim,
 * including any other `{{...}}` text, such as Jinja in a code example.
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
 * The facts about the environment a block can be conditioned on. Each must be
 * fixed for the session, since the output is only regenerated on the next
 * launch.
 */
export interface TemplateFlags {
	/** Positron's UI runs in a browser, so apps are served through a proxy. */
	readonly web: boolean;
}

export interface ExpandResult {
	/** The template with every directive replaced. */
	readonly text: string;
	/** Command ids named by a directive that were absent from the metadata. */
	readonly unresolved: readonly string[];
	/** Malformed conditional blocks, one message each, with line numbers. */
	readonly problems: readonly string[];
}

/** Matches `{{command:ID}}`, capturing the id. */
const DIRECTIVE = /\{\{command:([^}]+)\}\}/g;

/** Matches a line that is only an `{{if:FLAG}}` or `{{endif}}` marker. */
const BLOCK_MARKER_LINE = /^\s*\{\{(?:if:(?<flag>[^}]*)|endif)\}\}\s*$/;

/** Matches a block marker anywhere in a line. */
const BLOCK_MARKER = /\{\{(?:if:[^}]*|endif)\}\}/g;

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

function isFlag(name: string, flags: TemplateFlags): name is keyof TemplateFlags {
	return Object.prototype.hasOwnProperty.call(flags, name);
}

/**
 * Keep the blocks whose flag is set in `flags` and drop the rest, along with
 * every marker line. A dropped block takes one adjacent blank line with it, so
 * it leaves no gap behind. A malformed block is reported in `problems` and
 * never leaks a marker: an unknown flag or an unclosed block is dropped, and a
 * stray, nested, or inline marker is removed.
 */
function applyBlocks(template: string, flags: TemplateFlags, problems: string[]): string {
	const output: string[] = [];
	// The open block, if any: its flag's value and the line it opened on.
	let block: { readonly keep: boolean; readonly line: number } | undefined;
	let skipBlank = false;
	const lines = template.split('\n');
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const lineNumber = index + 1;
		const marker = BLOCK_MARKER_LINE.exec(line);
		if (marker) {
			const flag = marker.groups?.flag;
			if (flag === undefined) {
				if (!block) {
					problems.push(`line ${lineNumber}: {{endif}} with no open {{if:...}}`);
					continue;
				}
				// A dropped block takes the blank line after it when there is
				// one before it too, or when it opened the file.
				const last = output.at(-1);
				skipBlank = !block.keep && (last === undefined || last.trim() === '');
				block = undefined;
				continue;
			}
			if (block) {
				problems.push(`line ${lineNumber}: {{if:${flag}}} is nested in the block opened on line ${block.line}`);
				continue;
			}
			const name = flag.trim();
			const known = isFlag(name, flags);
			if (!known) {
				problems.push(`line ${lineNumber}: unknown flag '${name}'`);
			}
			block = { keep: known && flags[name], line: lineNumber };
			continue;
		}
		if (skipBlank) {
			skipBlank = false;
			if (line.trim() === '') {
				continue;
			}
		}
		if (block && !block.keep) {
			continue;
		}
		const stripped = line.replace(BLOCK_MARKER, '');
		if (stripped !== line) {
			problems.push(`line ${lineNumber}: a block marker must be on a line of its own`);
		}
		output.push(stripped);
	}
	if (block) {
		problems.push(`line ${block.line}: {{if:...}} has no {{endif}}`);
	}
	return output.join('\n');
}

/**
 * Keep the blocks in `template` that apply under `flags`, then replace every
 * directive with facts from `commandsById`. An id with no matching command
 * degrades to an empty section (never a leaked `{{...}}`) and is reported in
 * {@link ExpandResult.unresolved} so the caller can treat it as drift.
 */
export function expandTemplate(
	template: string,
	commandsById: ReadonlyMap<string, AgentCommand>,
	flags: TemplateFlags,
): ExpandResult {
	const unresolved = new Set<string>();
	const problems: string[] = [];
	const text = applyBlocks(template, flags, problems).replace(DIRECTIVE, (_match, rawId: string) => {
		const id = rawId.trim();
		const command = commandsById.get(id);
		if (!command) {
			unresolved.add(id);
			return renderCommand({ id });
		}
		return renderCommand(command);
	});
	return { text, unresolved: [...unresolved], problems };
}
