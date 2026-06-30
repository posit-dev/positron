/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMcpCallToolResult, McpContent } from '../../../../platform/positronMcp/common/positronMcpTools.js';
import { ILanguageRuntimePackage } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { QueryTableSummaryResult, Variable } from '../../../services/languageRuntime/common/positronVariablesComm.js';

/** Cap on a single text tool result, matching the extension's 8KB limit. */
export const MAX_OUTPUT_LENGTH = 8 * 1024;

/** Truncate long text output with a trailing marker, as the extension did. */
export function truncateOutput(text: string): string {
	return text.length > MAX_OUTPUT_LENGTH
		? text.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[output truncated]'
		: text;
}

/** Wrap plain text as a successful MCP tool result, truncating long output. */
export function textResult(text: string): IMcpCallToolResult {
	const content: McpContent[] = [{ type: 'text', text: truncateOutput(text) }];
	return { content };
}

/** Wrap an image (mime + base64 data) as a successful MCP tool result. */
export function imageResult(mimeType: string, data: string): IMcpCallToolResult {
	const content: McpContent[] = [{ type: 'image', data, mimeType }];
	return { content };
}

// --- Variables ---------------------------------------------------------------

/**
 * Render the variable list (get-variables). `languageName` labels the workspace.
 * Ported verbatim from the extension's describeVariables formatting.
 */
export function formatVariables(variables: Variable[], languageName: string): string {
	if (variables.length === 0) {
		return 'No variables in your workspace yet';
	}

	const lines = variables.map(v => {
		let display = v.display_value;
		if (display.includes('DataFrame')) {
			const match = display.match(/\[(\d+) rows x (\d+) columns\]/);
			if (match) {
				// allow-any-unicode-next-line
				display = `DataFrame with ${match[1]} rows × ${match[2]} columns`;
			}
		} else if (display.length > 50) {
			display = display.substring(0, 50) + '...';
		}
		return `• ${v.display_name} - ${v.display_type} ${display ? `: ${display}` : ''}`;
	});

	let text = `You have ${variables.length} variable${variables.length !== 1 ? 's' : ''} in your ${languageName} workspace:\n\n${lines.join('\n')}`;

	const dataframes = variables.filter(v => v.display_type.includes('DataFrame'));
	if (dataframes.length > 0) {
		const info = dataframes.map(df => {
			const match = df.display_value.match(/\[(\d+) rows x (\d+) columns\]/);
			// allow-any-unicode-next-line
			return match ? `${df.display_name} (${match[1]} rows × ${match[2]} columns)` : df.display_name;
		});
		text += `\n\nDataFrames: ${info.join(', ')}`;
	}
	return truncateOutput(text);
}

/** Render one variable's detail plus its children (inspect-variable). */
export function formatVariableDetail(variable: Variable, children: Variable[]): string {
	const lines = [
		`${variable.display_name}: ${variable.display_type}`,
		variable.type_info ? `Class: ${variable.type_info}` : undefined,
		`Value: ${variable.display_value}`,
		`Length: ${variable.length}`,
	].filter((line): line is string => line !== undefined);

	if (variable.has_children) {
		lines.push('', `Children (${children.length}):`);
		for (const child of children) {
			const value = child.display_value.length > 80 ? child.display_value.slice(0, 80) + '...' : child.display_value;
			lines.push(`  ${child.display_name} - ${child.display_type}${value ? ` : ${value}` : ''}`);
		}
	}
	return truncateOutput(lines.join('\n'));
}

// --- Packages ----------------------------------------------------------------

/** Render the installed-package list (get-packages). */
export function formatPackages(packages: ILanguageRuntimePackage[], languageName: string): string {
	if (packages.length === 0) {
		return 'No packages reported for the active session.';
	}
	const sorted = [...packages].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	const lines = sorted.map(pkg => {
		const flags: string[] = [];
		if (pkg.attached) {
			flags.push('attached');
		}
		if (pkg.outdated) {
			flags.push(pkg.latestVersion ? `outdated -> ${pkg.latestVersion}` : 'outdated');
		}
		const suffix = flags.length ? ` (${flags.join(', ')})` : '';
		return `• ${pkg.name} ${pkg.version}${suffix}`;
	});
	return truncateOutput(`${packages.length} packages installed in your ${languageName} session:\n\n${lines.join('\n')}`);
}

// --- Table profile (profile-data) --------------------------------------------

/**
 * The parsed shapes of the JSON strings querySessionTables returns in
 * `column_schemas` / `column_profiles`. Each profile carries its own
 * `column_name` because Python omits columns whose stats failed, so the profiles
 * array is not index-aligned with the schema -- match by name. `summary_stats`
 * is the only profile the table-summary RPC computes.
 */
interface ParsedColumnSchema { column_name: string; type_display: string }
interface NumberStats { min_value?: string; max_value?: string; mean?: string; median?: string; stdev?: string }
interface StringStats { num_empty?: number; num_unique?: number }
interface BooleanStats { true_count?: number; false_count?: number }
interface DateStats { num_unique?: number; min_date?: string; max_date?: string }
interface ParsedSummaryStats {
	number_stats?: NumberStats;
	string_stats?: StringStats;
	boolean_stats?: BooleanStats;
	date_stats?: DateStats;
	datetime_stats?: DateStats;
	other_stats?: { num_unique?: number };
}
interface ParsedColumnProfile { column_name?: string; summary_stats?: ParsedSummaryStats | null }

/** Render one column's summary stats as a compact one-liner based on its data type. */
function formatSummaryStats(stats: ParsedSummaryStats): string {
	if (stats.number_stats) {
		const n = stats.number_stats;
		return [
			n.min_value !== undefined ? `min ${n.min_value}` : undefined,
			n.max_value !== undefined ? `max ${n.max_value}` : undefined,
			n.mean !== undefined ? `mean ${n.mean}` : undefined,
			n.median !== undefined ? `median ${n.median}` : undefined,
			n.stdev !== undefined ? `sd ${n.stdev}` : undefined,
		].filter((part): part is string => part !== undefined).join(', ');
	}
	if (stats.string_stats) {
		const s = stats.string_stats;
		return [
			s.num_unique !== undefined ? `${s.num_unique} unique` : undefined,
			s.num_empty !== undefined ? `${s.num_empty} empty` : undefined,
		].filter((part): part is string => part !== undefined).join(', ');
	}
	if (stats.boolean_stats) {
		const b = stats.boolean_stats;
		return `${b.true_count ?? 0} true, ${b.false_count ?? 0} false`;
	}
	const dateStats = stats.date_stats ?? stats.datetime_stats;
	if (dateStats) {
		return [
			dateStats.num_unique !== undefined ? `${dateStats.num_unique} unique` : undefined,
			dateStats.min_date !== undefined ? `min ${dateStats.min_date}` : undefined,
			dateStats.max_date !== undefined ? `max ${dateStats.max_date}` : undefined,
		].filter((part): part is string => part !== undefined).join(', ');
	}
	if (stats.other_stats?.num_unique !== undefined) {
		return `${stats.other_stats.num_unique} unique`;
	}
	return '';
}

/**
 * Format a querySessionTables result into a compact per-column profile block.
 * Throws on unparseable JSON (surfaced to the caller as a tool error).
 */
export function formatTableProfile(name: string, result: QueryTableSummaryResult, columnsFilter?: string[]): string {
	const schemas = result.column_schemas.map(s => JSON.parse(s) as ParsedColumnSchema);
	const profiles = result.column_profiles.map(p => JSON.parse(p) as ParsedColumnProfile);

	const profileByName = new Map<string, ParsedColumnProfile>();
	for (const profile of profiles) {
		if (profile.column_name !== undefined) {
			profileByName.set(profile.column_name, profile);
		}
	}

	let columns = schemas;
	if (columnsFilter && columnsFilter.length > 0) {
		const wanted = new Set(columnsFilter);
		columns = schemas.filter(c => wanted.has(c.column_name));
		if (columns.length === 0) {
			return `None of the requested columns (${columnsFilter.join(', ')}) exist in "${name}". Use inspect-variable to list its columns.`;
		}
	}

	const lines = columns.map(column => {
		const stats = column.column_name !== undefined ? profileByName.get(column.column_name)?.summary_stats : undefined;
		const formatted = stats ? formatSummaryStats(stats) : '';
		return `• ${column.column_name} (${column.type_display})${formatted ? `: ${formatted}` : ''}`;
	});

	const header = `Profile of "${name}" (${result.num_rows} rows x ${result.num_columns} columns):`;
	return truncateOutput(`${header}\n\n${lines.join('\n')}`);
}
