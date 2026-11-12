/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Expands the mechanical facts of a command (its argument shapes and return
 * value) or a setting (its type, default, and allowed values) into a skill
 * template, leaving the surrounding hand-written guidance untouched. The facts
 * come from live metadata, so they are never hand-copied and cannot drift from
 * the code.
 *
 * A template carries two directives:
 *   {{command:some.command.id}}   -> renders the command's Arguments and
 *                                    Returns sections, labels included.
 *   {{setting:some.setting.key}}  -> renders the setting's Type, Default, and
 *                                    Allowed values, labels included.
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
 * The registry facts about a setting needed to render a template. A subset of
 * what `positronSettings.findSettings` reports: only the facts fixed for the
 * build, never the current value, which can change mid-session.
 */
export interface AgentSetting {
	readonly key: string;
	readonly type?: string | string[];
	readonly default?: unknown;
	readonly enum?: readonly unknown[];
	readonly minimum?: number;
	readonly maximum?: number;
	/** The deprecation message, present only when the setting is deprecated. */
	readonly deprecated?: string;
}

/**
 * The facts about the environment a block can be conditioned on. Each must be
 * fixed for the session, since the output is only regenerated on the next
 * launch.
 */
export interface TemplateFlags {
	/** Positron's UI runs in a browser, so apps are served through a proxy. */
	readonly web: boolean;
	/** Positron is connected to a remote host, where the user's files live. */
	readonly remote: boolean;
}

export interface ExpandResult {
	/** The template with every directive replaced. */
	readonly text: string;
	/** Command ids named by a directive that were absent from the metadata. */
	readonly unresolved: readonly string[];
	/** Setting keys named by a directive that were absent from the registry. */
	readonly unresolvedSettings: readonly string[];
	/** Malformed conditional blocks, one message each, with line numbers. */
	readonly problems: readonly string[];
}

/** Matches `{{command:ID}}`, capturing the id. */
const DIRECTIVE = /\{\{command:([^}]+)\}\}/g;

/** Matches `{{setting:KEY}}`, capturing the key. */
const SETTING_DIRECTIVE = /\{\{setting:([^}]+)\}\}/g;

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

/** Inline code, with a longer fence when the text itself holds a backtick. */
function code(text: string): string {
	return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

/** The allowed values: the enum when there is one, else a declared numeric range. */
function renderAllowedValues(setting: AgentSetting): string | undefined {
	if (setting.enum?.length) {
		return setting.enum.map(value => code(JSON.stringify(value))).join(', ');
	}
	const { minimum, maximum } = setting;
	if (minimum !== undefined && maximum !== undefined) {
		return `${code(String(minimum))} to ${code(String(maximum))}`;
	}
	if (minimum !== undefined) {
		return `at least ${code(String(minimum))}`;
	}
	if (maximum !== undefined) {
		return `at most ${code(String(maximum))}`;
	}
	return undefined;
}

/**
 * Render a setting's registry facts as a list, one labeled fact per item, so
 * the facts stay on separate lines when the Markdown is rendered. Allowed
 * values and deprecation appear only when the registry declares them.
 */
function renderSetting(setting: AgentSetting): string {
	const type = Array.isArray(setting.type) ? setting.type.join(' | ') : setting.type;
	const lines = [
		`- **Type:** ${type ? code(type) : 'unspecified'}`,
		`- **Default:** ${setting.default === undefined ? 'none' : code(JSON.stringify(setting.default))}`,
	];
	const allowed = renderAllowedValues(setting);
	if (allowed) {
		lines.push(`- **Allowed values:** ${allowed}`);
	}
	if (setting.deprecated) {
		lines.push(`- **Deprecated:** ${setting.deprecated}`);
	}
	return lines.join('\n');
}

/**
 * Every setting key named by a `{{setting:KEY}}` directive in `template`, in
 * order of first appearance. Includes keys inside conditional blocks, so the
 * caller can look the facts up once before expanding under any flags.
 */
export function collectSettingKeys(template: string): string[] {
	const keys = new Set<string>();
	for (const match of template.matchAll(SETTING_DIRECTIVE)) {
		keys.add(match[1].trim());
	}
	return [...keys];
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
	// The open block, if any: its flag's value, the line it opened on, and how
	// many nested markers are open inside it. A nested marker's `{{endif}}`
	// closes the nested marker, not the block, so a dropped block stays dropped.
	let block: { readonly keep: boolean; readonly line: number; nested: number } | undefined;
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
				if (block.nested > 0) {
					block.nested--;
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
				block.nested++;
				continue;
			}
			const name = flag.trim();
			const known = isFlag(name, flags);
			if (!known) {
				problems.push(`line ${lineNumber}: unknown flag '${name}'`);
			}
			block = { keep: known && flags[name], line: lineNumber, nested: 0 };
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
 * directive with facts from `commandsById` and `settingsByKey`. An id with no
 * matching command degrades to an empty section, and a key with no matching
 * setting to a line saying the build does not register it (never a leaked
 * `{{...}}`). Both are reported, in {@link ExpandResult.unresolved} and
 * {@link ExpandResult.unresolvedSettings}, so the caller can treat them as drift.
 */
export function expandTemplate(
	template: string,
	commandsById: ReadonlyMap<string, AgentCommand>,
	flags: TemplateFlags,
	settingsByKey: ReadonlyMap<string, AgentSetting> = new Map(),
): ExpandResult {
	const unresolved = new Set<string>();
	const unresolvedSettings = new Set<string>();
	const problems: string[] = [];
	const text = applyBlocks(template, flags, problems)
		.replace(DIRECTIVE, (_match, rawId: string) => {
			const id = rawId.trim();
			const command = commandsById.get(id);
			if (!command) {
				unresolved.add(id);
				return renderCommand({ id });
			}
			return renderCommand(command);
		})
		.replace(SETTING_DIRECTIVE, (_match, rawKey: string) => {
			const key = rawKey.trim();
			const setting = settingsByKey.get(key);
			if (!setting) {
				unresolvedSettings.add(key);
				// Unlike a command, a setting's empty facts would read as real
				// ones (a default of "none"), so say plainly that it is missing.
				return 'This setting is not registered in this Positron build.';
			}
			return renderSetting(setting);
		});
	return { text, unresolved: [...unresolved], unresolvedSettings: [...unresolvedSettings], problems };
}
