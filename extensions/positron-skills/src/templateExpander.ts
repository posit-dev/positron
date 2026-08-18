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
 * A template carries two directives, each naming a command id:
 *   {{args:some.command.id}}      -> renders the argument list, or "None."
 *   {{returns:some.command.id}}   -> renders the return description, or "None."
 *
 * Everything else in the template -- the when-to-use prose, the caveats the
 * metadata gets wrong -- is authored by hand and passes through verbatim.
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

export interface ExpandResult {
	/** The template with every directive replaced. */
	readonly text: string;
	/** Command ids named by a directive that were absent from the metadata. */
	readonly unresolved: readonly string[];
}

/** Matches `{{args:ID}}` and `{{returns:ID}}`, capturing the kind and the id. */
const DIRECTIVE = /\{\{(args|returns):([^}]+)\}\}/g;

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
	return command.returns ?? 'None.';
}

/**
 * Replace every directive in `template` with facts from `commandsById`. An id
 * with no matching command degrades to "None." (never a leaked `{{...}}`) and
 * is reported in {@link ExpandResult.unresolved} so the caller can treat it as
 * drift.
 */
export function expandTemplate(
	template: string,
	commandsById: ReadonlyMap<string, AgentCommand>,
): ExpandResult {
	const unresolved = new Set<string>();
	const text = template.replace(DIRECTIVE, (_match, kind: string, rawId: string) => {
		const id = rawId.trim();
		const command = commandsById.get(id);
		if (!command) {
			unresolved.add(id);
			return 'None.';
		}
		return kind === 'args' ? renderArgs(command) : renderReturns(command);
	});
	return { text, unresolved: [...unresolved] };
}
