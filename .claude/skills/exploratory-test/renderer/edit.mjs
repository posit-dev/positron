/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The plain-language pass after verification, shared by CI (run.mjs) and a
// local run. The explorer writes its findings after hours in the code, and its
// titles pick up internal names and knotted sentences. A fresh agent that sees
// only what a reader sees rewrites the Result line and each title, Observed
// and Expected, and this file keeps any rewrite that drops a fact out of the
// report.
//
// Local usage, around an editor subagent:
//   node edit.mjs prompt <run dir>
//     writes <run dir>/edit-prompt.md and prints its path, or says there is
//     nothing to edit
//   node edit.mjs apply <run dir> <reply file>
//     applies the reply's edits to report.md, skipping any the guard rejects

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTitles, rewriteLabel } from './finish.mjs';

const FIELDS = { TITLE: 'title', OBSERVED: 'observed', EXPECTED: 'expected' };
// The Result line is keyed 0, beside the findings' own numbers.
const SUMMARY = 0;

/** The `**Result:**` line above the first section, or undefined. */
function resultOf(report) {
	const top = String(report ?? '').split(/^## /m)[0];
	return /^\*\*Result:\*\*\s*(.*)$/m.exec(top)?.[1].trim();
}

/**
 * Each finding card from its heading through Expected: what a reader sees
 * before the investigation parts. Cause and Evidence are left out so the
 * editor cannot pick up the internal names the rewrite is meant to remove.
 */
export function editorFindings(report) {
	const out = [];
	let keep = false;
	for (const line of String(report ?? '').split('\n')) {
		if (/^###\s+Finding\s+\d+:/.test(line)) {
			keep = true;
			out.push(...(out.length ? [''] : []));
		} else if (/^(##\s|###\s|<details>)/.test(line) || /^\*\*(Evidence|Error output|Cause|Test gap)/.test(line)) {
			keep = false;
		}
		if (keep) {
			out.push(line);
			if (line.startsWith('**Expected:**')) {
				keep = false;
			}
		}
	}
	return out.join('\n').trim();
}

/** editor.md with the Result and findings filled in, or null when there is neither. */
export function buildEditPrompt(template, report) {
	for (const placeholder of ['{{RESULT}}', '{{FINDINGS}}']) {
		if (!String(template).includes(placeholder)) {
			throw new Error(`editor.md has no ${placeholder} placeholder`);
		}
	}
	const result = resultOf(report);
	const findings = editorFindings(report);
	if (!result && !findings) {
		return null;
	}
	return String(template)
		.replace('{{RESULT}}', result ? `**Result:** ${result}` : 'No Result line.')
		.replace('{{FINDINGS}}', findings || 'No findings.')
		.trim();
}

/** `TITLE: 1=...` and `RESULT: ...` lines: a Map of finding number (0 for the Result) to the fields it rewrites. */
export function parseEdits(text) {
	const out = new Map();
	for (const line of String(text ?? '').split('\n')) {
		const m = /^(TITLE|OBSERVED|EXPECTED):\s*(\d+)\s*=\s*(.+)$/i.exec(line.trim());
		const result = /^RESULT:\s*(.+)$/i.exec(line.trim());
		if (result) {
			out.set(SUMMARY, { result: result[1].trim() });
		} else if (m) {
			const n = Number(m[2]);
			out.set(n, { ...out.get(n), [FIELDS[m[1].toUpperCase()]]: m[3].trim() });
		}
	}
	return out;
}

/** The Result, and each finding's title, Observed and Expected, as the report has them. */
export function currentFields(report) {
	const out = new Map();
	const result = resultOf(report);
	if (result !== undefined) {
		out.set(SUMMARY, { result });
	}
	let n = null;
	for (const line of String(report ?? '').split('\n')) {
		const heading = /^###\s+Finding\s+(\d+):\s*(.*)$/.exec(line);
		if (heading) {
			n = Number(heading[1]);
			out.set(n, { title: heading[2].trim() });
		} else if (/^(<details>|## )/.test(line)) {
			n = null;
		} else if (n !== null) {
			const field = /^\*\*(Observed|Expected):\*\*\s*(.*)$/.exec(line);
			if (field) {
				out.get(n)[field[1].toLowerCase()] = field[2].trim();
			}
		}
	}
	return out;
}

/**
 * What a rewrite must keep word for word: code spans, quoted strings and
 * numbers, and in a title every capitalized word after the first, since those
 * name the language, command or setting the bug needs.
 */
export function factsOf(text, { title = false } = {}) {
	const spans = [...text.matchAll(/`[^`]+`/g)].map(m => m[0]);
	const prose = text.replace(/`[^`]+`/g, ' ');
	const quotes = [...prose.matchAll(/"[^"]+"/g)].map(m => m[0]);
	const numbers = [...prose.replace(/"[^"]+"/g, ' ').matchAll(/(?<![\w.])\d+(?:[.,]\d+)*(?![\w])/g)].map(m => m[0]);
	const names = title ? [...prose.replace(/"[^"]+"/g, ' ').matchAll(/(?<=\s)[A-Z][\w.]*/g)].map(m => m[0].replace(/\.$/, '')) : [];
	return [...new Set([...spans, ...quotes, ...numbers, ...names])];
}

/**
 * What a Result rewrite must keep. The bold sentence is what is broken, so it
 * keeps its names as a title does; the rest may shrink a list of what worked
 * to a phrase, as long as its numbers, quotes and code survive.
 */
function resultFacts(text) {
	const bold = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1]);
	return [...new Set([...bold.flatMap(b => factsOf(b, { title: true })), ...factsOf(text.replace(/\*\*[^*]+\*\*/g, ' '))])];
}

/**
 * The edits safe to apply, and why each other one is not. A rewrite is
 * rejected when it loses a fact the original had, or when a title would break
 * the findings table or the filed issue's title.
 */
export function reviewEdits(report, edits) {
	const current = currentFields(report);
	const kept = new Map();
	const rejected = [];
	for (const [n, fields] of edits) {
		for (const [field, after] of Object.entries(fields)) {
			const before = current.get(n)?.[field];
			const facts = before === undefined ? [] : field === 'result' ? resultFacts(before) : factsOf(before, { title: field === 'title' });
			const lost = facts.filter(f => !new RegExp(`(?<![\\w])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(after));
			const reason = before === undefined ? (field === 'result' ? 'the report has no Result' : `Finding ${n} has no ${field}`)
				: lost.length ? `loses ${lost.join(', ')}`
					: field === 'title' && /[|;]/.test(after) ? 'has a | or ;'
						: field === 'result' && before.includes('**') && !/\*\*[^*]+\*\*/.test(after) ? 'drops the bold'
							: '';
			if (reason) {
				rejected.push({ n, field, reason });
			} else if (after !== before) {
				kept.set(n, { ...kept.get(n), [field]: after });
			}
		}
	}
	return { kept, rejected };
}

/** The report with the kept edits applied: the Result, titles in heading and table, Observed and Expected in the card. */
export function applyEdits(report, kept) {
	const pick = field => new Map([...kept].filter(([, f]) => f[field] !== undefined).map(([n, f]) => [n, f[field]]));
	const result = kept.get(SUMMARY)?.result;
	const [top, ...sections] = String(report).split(/^(?=## )/m);
	const summarized = result === undefined ? report : [top.replace(/^\*\*Result:\*\*.*$/m, () => `**Result:** ${result}`), ...sections].join('');
	return rewriteLabel(rewriteLabel(applyTitles(summarized, pick('title')), 'Observed', pick('observed')), 'Expected', pick('expected'));
}

const EDITOR_PATH = fileURLToPath(new URL('../editor.md', import.meta.url));

function main(argv) {
	const [command, dir, replyFile] = argv;
	const reportPath = dir && join(dir, 'report.md');
	if (!reportPath || !existsSync(reportPath)) {
		console.error('usage: node edit.mjs prompt <run dir>\n       node edit.mjs apply <run dir> <reply file>');
		return 2;
	}
	const report = readFileSync(reportPath, 'utf8');
	if (command === 'prompt') {
		const prompt = buildEditPrompt(readFileSync(EDITOR_PATH, 'utf8'), report);
		if (!prompt) {
			console.log('nothing to edit: no Result or findings');
			return 0;
		}
		const out = join(dir, 'edit-prompt.md');
		writeFileSync(out, prompt);
		console.log(out);
		return 0;
	}
	if (command === 'apply') {
		if (!replyFile || !existsSync(replyFile)) {
			console.error(`edit: reply file not found: ${replyFile ?? '(none given)'}`);
			return 2;
		}
		const { kept, rejected } = reviewEdits(report, parseEdits(readFileSync(replyFile, 'utf8')));
		for (const r of rejected) {
			console.error(`edit: kept ${r.field === 'result' ? 'the original Result' : `Finding ${r.n}'s original ${r.field}`}: the rewrite ${r.reason}`);
		}
		writeFileSync(reportPath, applyEdits(report, kept));
		console.log(`edit: ${[...kept.values()].reduce((sum, f) => sum + Object.keys(f).length, 0)} field(s) rewritten in ${reportPath}`);
		return 0;
	}
	console.error(`edit: unknown command ${command ?? ''}`);
	return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
