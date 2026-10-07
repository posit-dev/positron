/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The plain-language pass after verification, shared by CI (run.mjs) and a
// local run. The explorer writes each finding as a record of the run: harness
// steps, PASS checks, scenario IDs and reasoning. A fresh agent that sees only
// what a reader sees writes, for each finding, the opening a person reads
// first (a summary, the steps to do by hand, and where it happens) and a title
// cut from that summary, and rewrites the Result line. This file stores the
// opening at the top of the card and keeps the original of anything that
// cites a fact the run did not record.
//
// Local usage, around an editor subagent:
//   node edit.mjs prompt <run dir>
//     writes <run dir>/edit-prompt.md and prints its path, or says there is
//     nothing to edit
//   node edit.mjs apply <run dir> <reply file> [--last]
//     applies the reply's edits to report.md, skipping any the guard rejects.
//     When it rejects any, it writes <run dir>/edit-retry-prompt.md and prints
//     its path, for one more try applied with --last.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTitles } from './finish.mjs';
import { SUMMARY_WORDS, wordsOf } from './lint.mjs';
import { nextFence, openingRange, parseOpening } from './report-parse.mjs';

// The Result line is keyed 0, beside the findings' own numbers.
const SUMMARY = 0;
// A title's description after `<feature>: `, as the filed issue has it. The prompt
// aims for 12; the guard rejects only a run-on, so a retry never trades a true title for a short one.
const TITLE_WORDS = 15;
const OPENING_WORDS = 60;
const MAX_STEPS = 6;
const SCENARIO_ID = /\b[SR]\d{2}(?:-\d{2})?\b/;

/** The `**Result:**` line above the first section, or undefined. */
function resultOf(report) {
	const top = String(report ?? '').split(/^## /m)[0];
	return /^\*\*Result:\*\*\s*(.*)$/m.exec(top)?.[1].trim();
}

/** Each finding card, by number: its heading's line index, end, title and Feature. */
function cardsOf(lines) {
	const out = new Map();
	let card = null;
	lines.forEach((line, i) => {
		const heading = /^###\s+Finding\s+(\d+):\s*(.*)$/.exec(line);
		if (heading || /^(##\s|###\s|<details>)/.test(line)) {
			if (card) {
				card.end = i;
			}
			card = null;
		}
		if (heading) {
			card = { at: i, end: lines.length, title: heading[2].trim(), feature: '' };
			out.set(Number(heading[1]), card);
		} else if (card && /^\*\*Feature:\*\*/.test(line)) {
			card.feature = line.replace(/^\*\*Feature:\*\*\s*/, '').trim();
		}
	});
	return out;
}

/**
 * One card from its heading through Expected, without an opening written
 * before: what the run recorded that a reader sees. Cause and Evidence are left
 * out so the editor cannot pick up the internal names it is meant to remove.
 */
function recordOf(lines, card) {
	const body = lines.slice(card.at + 1, card.end);
	const opening = openingRange(body);
	const kept = opening ? [...body.slice(0, opening.start), ...body.slice(opening.end)] : body;
	const out = [lines[card.at]];
	for (const line of kept) {
		if (/^\*\*(Evidence|Error output|Cause|Test gap)/.test(line)) {
			break;
		}
		out.push(line);
		if (line.startsWith('**Expected:**')) {
			break;
		}
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Every finding's record, as the editor sees them. */
export function editorFindings(report) {
	const lines = String(report ?? '').split('\n');
	return [...cardsOf(lines).values()].map(card => recordOf(lines, card)).join('\n\n');
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
		.replace('{{RESULT}}', () => (result ? `**Result:** ${result}` : 'No Result line.'))
		.replace('{{FINDINGS}}', () => findings || 'No findings.')
		.trim();
}

/**
 * The reply as a Map of finding number (0 for the Result) to what it writes:
 * `{ result }`, or `{ title, opening: { summary, steps, where } }`.
 */
export function parseEdits(text) {
	const out = new Map();
	const [head, ...blocks] = String(text ?? '').split(/^===\s*Finding\s+(?=\d)/mi);
	const result = /^RESULT:\s*(.+)$/mi.exec(head);
	if (result) {
		out.set(SUMMARY, { result: result[1].trim() });
	}
	for (const block of blocks) {
		const [first, ...lines] = block.split('\n');
		const n = Number(/^\d+/.exec(first)[0]);
		const fields = { summary: [], steps: [], where: [] };
		let title;
		let key = null;
		let fence = null;
		for (const line of lines) {
			const label = fence ? null : /^(TITLE|SUMMARY|STEPS|WHERE):\s*(.*)$/i.exec(line.trim());
			if (label && label[1].toUpperCase() === 'TITLE') {
				title = label[2].trim();
				key = null;
			} else if (label) {
				key = label[1].toLowerCase();
				fields[key].push(label[2]);
			} else if (key) {
				fence = nextFence(fence, line);
				fields[key].push(line);
			}
		}
		const edit = {};
		if (title) {
			edit.title = title;
		}
		const summary = fields.summary.join(' ').replace(/\s+/g, ' ').trim();
		const steps = stepsOf(fields.steps);
		if (summary || steps.length) {
			edit.opening = { summary, steps, where: fields.where.join(' ').replace(/\s+/g, ' ').trim() };
		}
		if (Object.keys(edit).length) {
			out.set(n, edit);
		}
	}
	return out;
}

/** Numbered lines as steps, each with the lines under it, dedented. */
function stepsOf(lines) {
	const steps = [];
	let fence = null;
	for (const line of lines) {
		const numbered = !fence && /^\s*\d+\.\s+(.*)$/.exec(line);
		fence = nextFence(fence, line);
		if (numbered) {
			steps.push(numbered[1]);
		} else if (steps.length) {
			steps[steps.length - 1] += `\n${line.replace(/^\s{1,4}/, '')}`;
		}
	}
	return steps.map(s => s.trimEnd());
}

/** The Result, and each finding's title, Feature, record and opening, as the report has them. */
export function currentFields(report) {
	const out = new Map();
	const result = resultOf(report);
	if (result !== undefined) {
		out.set(SUMMARY, { result });
	}
	const lines = String(report ?? '').split('\n');
	for (const [n, card] of cardsOf(lines)) {
		out.set(n, { title: card.title, feature: card.feature, record: recordOf(lines, card), opening: parseOpening(lines.slice(card.at + 1, card.end)) });
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

const FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 1,500 and 1500 are the same number.
const bareNumber = text => text.replace(/(?<=\d),(?=\d{3})/g, '');
// A code block's lines, trimmed, so indenting it under a step does not count as a change.
const codeOf = block => block.split('\n').map(l => l.trim()).filter(Boolean).join('\n');

/**
 * The facts `text` cites that its record does not have: code and quoted text
 * the record never shows, and numbers it never gives. The opening is new
 * writing, so this checks the other way from a rewrite: nothing invented.
 */
function unsupported(text, record) {
	const recordCode = [...record.matchAll(FENCE)].map(m => codeOf(m[2])).join('\n');
	const haystack = `${record}\n${recordCode}`;
	const out = [];
	for (const m of text.matchAll(FENCE)) {
		out.push(...codeOf(m[2]).split('\n').filter(line => !recordCode.includes(line) && !record.includes(line)));
	}
	const prose = text.replace(FENCE, ' ');
	for (const fact of factsOf(prose)) {
		const missing = /^[`"]/.test(fact)
			? !haystack.includes(fact.slice(1, -1))
			: !new RegExp(`(?<![\\w.])${escape(bareNumber(fact))}(?![\\w])`).test(bareNumber(haystack));
		if (missing) {
			out.push(fact);
		}
	}
	return [...new Set(out)];
}

/** The title without a `<feature>: ` prefix the issue adds itself. */
function bareTitle(title, feature) {
	return feature && title.toLowerCase().startsWith(`${feature.toLowerCase()}:`) ? title.slice(feature.length + 1).trim() : title;
}

function titleProblem(title, record) {
	const words = wordsOf(title);
	const invented = unsupported(title, record);
	return /[|;`]/.test(title) ? 'has a |, ; or code'
		: words > TITLE_WORDS ? `is ${words} words, over ${TITLE_WORDS}; cut filler, never a word that narrows the bug`
			: SCENARIO_ID.test(title) ? `names the scenario ID ${SCENARIO_ID.exec(title)[0]}`
				: invented.length ? `cites ${invented.join(', ')}, which the record does not have`
					: '';
}

function openingProblem(opening, record) {
	const text = [opening.summary, ...opening.steps, opening.where].join('\n');
	const words = wordsOf(opening.summary);
	const lost = [...record.matchAll(FENCE)].map(m => codeOf(m[2])).filter(code => ![...text.matchAll(FENCE)].some(m => codeOf(m[2]).includes(code)));
	const invented = unsupported(text, record);
	return !opening.summary ? 'has no summary'
		: !opening.steps.length ? 'has no steps'
			: opening.steps.length > MAX_STEPS ? `has ${opening.steps.length} steps, over ${MAX_STEPS}`
				: words > OPENING_WORDS ? `has a ${words}-word summary, over ${OPENING_WORDS}`
					: SCENARIO_ID.test(text) ? `names the scenario ID ${SCENARIO_ID.exec(text)[0]}`
						: lost.length ? `leaves out the code the record has the reader run: ${lost.map(c => `"${c.split('\n')[0]}"`).join(', ')}`
							: invented.length ? `cites ${invented.join(', ')}, which the record does not have`
								: '';
}

function resultProblem(before, after) {
	const lost = resultFacts(before).filter(f => !new RegExp(`(?<![\\w])${escape(f)}(?![\\w])`).test(after));
	return lost.length ? `loses ${lost.join(', ')}`
		: before.includes('**') && !/\*\*[^*]+\*\*/.test(after) ? 'drops the bold'
			: wordsOf(after) > SUMMARY_WORDS ? `is ${wordsOf(after)} words, over ${SUMMARY_WORDS}`
				: '';
}

/**
 * The edits safe to apply, and why each other one is not. A Result is
 * rejected when it loses a fact the original had; a title or opening when it
 * cites one the record does not have, or would read worse than the record.
 */
export function reviewEdits(report, edits) {
	const current = currentFields(report);
	const kept = new Map();
	const rejected = [];
	const keep = (n, field, value) => kept.set(n, { ...kept.get(n), [field]: value });
	for (const [n, fields] of edits) {
		const now = current.get(n);
		for (const [field, value] of Object.entries(fields)) {
			const after = field === 'title' ? bareTitle(value, now?.feature) : value;
			const reason = now === undefined ? (n === SUMMARY ? 'the report has no Result' : `Finding ${n} is not in the report`)
				: field === 'result' ? resultProblem(now.result, after)
					: field === 'title' ? titleProblem(after, now.record)
						: openingProblem(after, now.record);
			if (reason) {
				rejected.push({ n, field, reason, after });
			} else if (field !== 'title' || after !== now.title) {
				keep(n, field, after);
			}
		}
	}
	return { kept, rejected };
}

/**
 * The edit prompt again, for one more try at what the guard rejected, each
 * with the reason; null when none can be retried.
 */
export function buildRetryPrompt(template, report, rejected) {
	const current = currentFields(report);
	const retry = rejected.filter(r => current.has(r.n));
	const prompt = retry.length ? buildEditPrompt(template, report) : null;
	if (!prompt) {
		return null;
	}
	const lines = retry.map(r => (r.field === 'result' ? `- Result: "${r.after}" ${r.reason}.`
		: r.field === 'title' ? `- Finding ${r.n} title: "${r.after}" ${r.reason}.`
			: `- Finding ${r.n} opening: ${r.reason}.`));
	return [
		prompt,
		'## Rewrites to redo',
		'These were rejected, so the report keeps what the run wrote. Write each one again, fixing what its reason names, and follow every rule above. Reply in the same format with only these: the RESULT line, or a finding\'s block with only its TITLE line, or only its SUMMARY, STEPS and WHERE.',
		lines.join('\n'),
	].join('\n\n');
}

/** The opening as the card stores it, at the top of the card. */
function openingLines({ summary, steps, where }) {
	return [
		`**Summary:** ${summary}`,
		'',
		'**Hand steps:**',
		'',
		...steps.map((step, i) => step.split('\n').map((line, k) => (k === 0 ? `${i + 1}. ${line}` : line && `   ${line}`)).join('\n')),
		...(where ? ['', `**Where:** ${where}`] : []),
	];
}

/** The report with the kept edits applied: the Result, titles in heading and table, and each opening. */
export function applyEdits(report, kept) {
	const titles = new Map([...kept].filter(([, f]) => f.title !== undefined).map(([n, f]) => [n, f.title]));
	const result = kept.get(SUMMARY)?.result;
	const [top, ...sections] = String(report).split(/^(?=## )/m);
	const summarized = result === undefined ? report : [top.replace(/^\*\*Result:\*\*.*$/m, () => `**Result:** ${result}`), ...sections].join('');
	let lines = applyTitles(summarized, titles).split('\n');
	// Last card first, so the earlier cards' line numbers hold.
	const cards = [...cardsOf(lines)].sort(([, a], [, b]) => b.at - a.at);
	for (const [n, card] of cards) {
		const opening = kept.get(n)?.opening;
		if (!opening) {
			continue;
		}
		const body = lines.slice(card.at + 1, card.end);
		const old = openingRange(body);
		const rest = old ? [...body.slice(0, old.start), ...body.slice(old.end)] : body;
		while (rest.length && !rest[0].trim()) {
			rest.shift();
		}
		lines = [...lines.slice(0, card.at + 1), '', ...openingLines(opening), '', ...rest, ...lines.slice(card.end)];
	}
	return lines.join('\n');
}

const EDITOR_PATH = fileURLToPath(new URL('../editor.md', import.meta.url));

/** What a kept or rejected edit is, for the log. */
function named(n, field) {
	return n === SUMMARY ? 'the Result' : `Finding ${n}'s ${field}`;
}

function main(argv) {
	const last = argv.includes('--last');
	const [command, dir, replyFile] = argv.filter(a => a !== '--last');
	const reportPath = dir && join(dir, 'report.md');
	if (!reportPath || !existsSync(reportPath)) {
		console.error('usage: node edit.mjs prompt <run dir>\n       node edit.mjs apply <run dir> <reply file> [--last]');
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
			console.error(`edit: kept the original of ${named(r.n, r.field)}: the rewrite ${r.reason}`);
		}
		const edited = applyEdits(report, kept);
		writeFileSync(reportPath, edited);
		console.log(`edit: ${[...kept.values()].reduce((sum, f) => sum + Object.keys(f).length, 0)} field(s) written in ${reportPath}`);
		const retry = last ? null : buildRetryPrompt(readFileSync(EDITOR_PATH, 'utf8'), edited, rejected);
		if (retry) {
			const out = join(dir, 'edit-retry-prompt.md');
			writeFileSync(out, retry);
			console.log(`edit: retry prompt at ${out}`);
		}
		return 0;
	}
	console.error(`edit: unknown command ${command ?? ''}`);
	return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
