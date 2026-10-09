/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Turns the report markdown into structured data the template can lay out on
// purpose: Observed beside Expected, a screenshot as a thumbnail.
//
// Every field here is something the agent already writes. Where a field cannot
// be recovered, the parser keeps the prose rather than dropping it: a finding
// whose labels do not match falls back to `proseHtml`, and the template renders
// that instead of the structured blocks.

import { Marked } from 'marked';
import { parseLinked } from './known-issues.mjs';

/** Escapes the characters that would otherwise open markup or close an attribute. */
export function escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Returns a URL safe to put in an href or src, or null.
 *
 * A report is not trusted input. The agent writes it while reading a branch's
 * diff, its logs and its UI, so a hostile branch can get a string of its
 * choosing quoted into one -- and the page is published on a report domain
 * shared with every other run. Only http(s), mailto and relative paths
 * survive; `javascript:` and `data:` do not.
 */
export function safeUrl(url) {
	// Browsers ignore control characters and spaces inside a scheme, so
	// `java\nscript:` reaches the same place as `javascript:`. Strip them before
	// deciding what the scheme is, and keep the stripped form.
	const cleaned = String(url ?? '').replace(/[\u0000-\u0020]/g, '');
	if (!cleaned) {
		return null;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) {
		return /^(?:https?|mailto):/i.test(cleaned) ? cleaned : null;
	}
	// No scheme, so a relative path. `//host/x` also lands here and resolves to
	// the page's scheme, which is https and already allowed.
	return cleaned;
}

/**
 * The one markdown parser the report uses, configured so nothing in a report
 * can inject markup.
 *
 * marked emits raw HTML verbatim and hrefs unfiltered by default. Every field
 * on the page goes through here, so this is the single place that has to be
 * right rather than each of the thirty call sites.
 */
const marked = new Marked({
	tokenizer: {
		// Only ~~ strikes through: a lone ~ is "about" (~L120), as on most pages but GitHub's.
		del(src) {
			if (/^~(?!~)/.test(src)) {
				return { type: 'text', raw: '~', text: '~' };
			}
			return false;
		},
	},
	renderer: {
		// Raw HTML in a report is something the agent transcribed, so it is text
		// to show, not markup to run.
		html(html) {
			return escapeHtml(html);
		},
		link(href, title, text) {
			const url = safeUrl(href);
			if (!url) {
				return text;
			}
			const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
			return `<a href="${escapeHtml(url)}"${titleAttr}>${text}</a>`;
		},
		image(href, title, text) {
			const url = safeUrl(href);
			if (!url) {
				return escapeHtml(text ?? '');
			}
			return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text ?? '')}" loading="lazy">`;
		},
	},
});

/** Inline markdown to HTML, for the contents of one line or cell. */
function inline(text) {
	return marked.parseInline(String(text ?? '').trim());
}

/** The text escaped HTML stands for: the entities marked and escapeHtml write. */
export function unescapeHtml(html) {
	return String(html ?? '')
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Inline markdown as plain text, for attributes such as a caption or label. */
function plainText(text) {
	return unescapeHtml(inline(text).replace(/<[^>]*>/g, '')).trim();
}

/** Block markdown to HTML, for a run of lines that may hold lists or code. */
function block(text) {
	return marked.parse(String(text ?? '').trim());
}

/**
 * Capitalizes a cell that reads as a sentence.
 *
 * The findings table and Coverage are written as phrases continuing their
 * column header ("user waits 30 s"), but the redesign gives them their own
 * column where they read as statements. Skipped when the cell opens with code,
 * a link or a quote, where a forced capital would corrupt an identifier.
 */
/** Package and tool names written in lowercase by convention; a sentence may start with one. */
export const LOWERCASE_NAMES = new Set(['pandas', 'polars', 'numpy', 'dplyr', 'ggplot2', 'tibble', 'data.table', 'pip', 'uv', 'pak', 'renv', 'reticulate', 'ipykernel', 'matplotlib', 'plotly', 'shiny', 'knitr', 'rmarkdown', 'rlang', 'tidyr', 'readr', 'purrr', 'scikit-learn', 'scipy', 'pyarrow', 'duckdb']);

function sentenceCase(text) {
	const s = String(text ?? '');
	if (!/^[a-z]/.test(s)) {
		return s;
	}
	// A package name keeps its real case: dplyr, not Dplyr.
	if (LOWERCASE_NAMES.has(/^[a-z][\w.-]*/.exec(s)[0])) {
		return s;
	}
	// A bare identifier keeps its case: `polars frame` is prose, `df.copy()` is not.
	if (/^[a-z_][\w.]*\s*[(=[]/.test(s)) {
		return s;
	}
	return s[0].toUpperCase() + s.slice(1);
}

/** Splits one markdown table row into trimmed cells. */
function cells(line) {
	return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

function isTableRow(line) {
	return line.trim().startsWith('|');
}

function isSeparatorRow(line) {
	return /^\|[\s:|-]+\|?$/.test(line.trim());
}

/**
 * Reads a markdown table starting at `start` into objects keyed by lowercased
 * header. Returns the rows and the index of the first line after the table.
 */
function readTable(lines, start) {
	const header = cells(lines[start]).map(c => c.toLowerCase());
	let i = start + 1;
	if (i < lines.length && isSeparatorRow(lines[i])) {
		i++;
	}
	const rows = [];
	for (; i < lines.length && isTableRow(lines[i]); i++) {
		if (isSeparatorRow(lines[i])) {
			continue;
		}
		const values = cells(lines[i]);
		const row = {};
		header.forEach((key, n) => { row[key] = values[n] ?? ''; });
		row._cells = values;
		rows.push(row);
	}
	return { header, rows, end: i };
}

/**
 * A cell that says "nothing here" instead of naming something: `none`, `n/a`,
 * a dash, or blank. A row whose scenario is one of these is not a scenario.
 */
function isPlaceholder(text) {
	const t = String(text ?? '').replace(/[*_`]/g, '').trim().replace(/\.$/, '').toLowerCase();
	return ['', 'none', 'n/a', 'na', '-', '\u2013', '\u2014'].includes(t);
}

/** Finds the first table whose header row matches `test`. */
function findTable(lines, test, from = 0, to = lines.length) {
	for (let i = from; i < to; i++) {
		if (isTableRow(lines[i]) && test(cells(lines[i]).map(c => c.toLowerCase()))) {
			return readTable(lines, i);
		}
	}
	return null;
}

/**
 * Collects a `**Label:** value` paragraph, including any continuation lines.
 *
 * A label's value can wrap: "Only under" in particular runs to two lines in
 * real reports. Collection stops at a blank line, a new label, a list item or
 * a heading, so a wrapped value is kept whole without swallowing the block
 * that follows it.
 */
function readLabelled(lines, start) {
	const out = [lines[start].replace(/^\*\*[^*]+[:*]*\*\*:?\s*/, '').trim()];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || /^\*\*/.test(line.trim()) || /^[#>]/.test(line.trim())
			|| /^(?:[-*]\s|\d+\.\s)/.test(line.trim())) {
			return { text: out.join(' ').trim(), end: i };
		}
		out.push(line.trim());
	}
	return { text: out.join(' ').trim(), end: lines.length };
}

/**
 * A finding's `**Preconditions:**`, one item per bullet. Older reports wrote
 * it as one line of prose, which stays one item. A file pasted under a bullet
 * stays with that bullet.
 */
function readPreconditions(lines, start) {
	if (lines[start].replace(/^\*\*[^*]+[:*]*\*\*:?\s*/, '').trim()) {
		const { text, end } = readLabelled(lines, start);
		return { items: [text], end };
	}
	const items = [];
	let i = start + 1;
	while (i < lines.length) {
		const t = lines[i].trim();
		if (/^[-*]\s+/.test(t)) {
			items.push(t.replace(/^[-*]\s+/, ''));
			i++;
			continue;
		}
		if (!items.length && !t) { i++; continue; }
		if (items.length && t && /^\s+/.test(lines[i]) && !/^ {0,3}(`{3,}|~{3,})/.test(lines[i])) {
			items[items.length - 1] += ` ${t}`;
			i++;
			continue;
		}
		const source = items.length ? readSourceBlock(lines, i) : null;
		if (source) {
			items[items.length - 1] += `\n\n${source.text}`;
			i = source.end;
			continue;
		}
		break;
	}
	return { items, end: i };
}

/**
 * A precondition that says nothing but "defaults" is not a precondition.
 *
 * The skill makes the agent state where the finding sits on the configuration
 * axis every time, which is worth keeping: a blank there could mean "needs
 * nothing" or "never checked". But once written, "Shipped defaults." on its own
 * is the absence of a condition, and printing it as a bullet asks the reader to
 * take in a line that tells them nothing. The same line qualified by how the
 * state was manufactured does tell them something, so it stays.
 */
const DEFAULTS_ONLY = /^(?:(?:the\s+)?(?:shipped|stock|product)\s+defaults?|defaults?|default\s+settings?|none)\s*[.!]?$/i;

export function isDefaultsOnly(text) {
	return DEFAULTS_ONLY.test(String(text ?? '').trim());
}

/**
 * A line trimmed for a heading test, or '' when indented four or more spaces:
 * that is an indented code block, and a pasted `## Setup` in it is source.
 */
function headingText(line) {
	return /^ {0,3}\S/.test(line) ? line.trim() : '';
}

/** Strips the indent a numbered list puts on a step's continuation lines. */
function dedent(line) {
	return line.replace(/^\s{1,4}/, '');
}

/**
 * Lengthens a step's outer code fence past anything nested inside it.
 *
 * A repro step often pastes source that is itself fenced -- a notebook cell
 * holding a ```python block, say. CommonMark closes on the first fence at least
 * as long as the one that opened, so three backticks wrapped around three
 * backticks end the block early and the rest of the source lands on the page as
 * markup. Reports are written by hand and get this wrong; widening the outer
 * fence fixes them without asking the agent to count backticks.
 */
function widenOuterFence(text) {
	const lines = text.split('\n');
	const open = lines.findIndex(l => /^(?:```|~~~)/.test(l));
	if (open === -1) {
		return text;
	}
	let close = -1;
	for (let i = lines.length - 1; i > open; i--) {
		if (/^(?:```|~~~)/.test(lines[i])) { close = i; break; }
	}
	if (close === -1) {
		return text;
	}
	const marker = lines[open].startsWith('~') ? '~' : '`';
	const outer = (/^(`+|~+)/.exec(lines[open]) || [''])[0].length;
	let longest = 0;
	for (let i = open + 1; i < close; i++) {
		const run = /^(`+|~+)/.exec(lines[i]);
		if (run && run[0][0] === marker) { longest = Math.max(longest, run[0].length); }
	}
	if (longest < outer) {
		return text;
	}
	const fence = marker.repeat(longest + 1);
	lines[open] = fence + lines[open].slice(outer);
	lines[close] = fence;
	return lines.join('\n');
}

/** `**Label:** rest` -> the label, lowercased, or null. */
function labelOf(line) {
	const m = /^\*\*([^*]+?)\*\*/.exec(line.trim());
	return m ? m[1].replace(/[:\s]+$/, '').toLowerCase() : null;
}

// The opening the edit pass writes at the top of a card, in a person's words:
// what they read first, above the run's own record.
const OPENING_LABELS = new Set(['summary', 'where']);

/** Where a card's opening sits in its body lines, as `{ start, end }`, or null. */
export function openingRange(lines) {
	const start = lines.findIndex(l => labelOf(l) === 'summary');
	if (start === -1) {
		return null;
	}
	let end = start + 1;
	for (; end < lines.length; end++) {
		const text = lines[end].trim();
		const label = labelOf(lines[end]);
		if (((label && !OPENING_LABELS.has(label)) || /^(?:#{2,3}\s|<details>)/.test(text))) {
			break;
		}
	}
	while (end > start + 1 && !lines[end - 1].trim()) {
		end--;
	}
	return { start, end };
}

/** A card's opening as `{ summary, where }`; null when it has none. */
export function parseOpening(lines) {
	const range = openingRange(lines);
	if (!range) {
		return null;
	}
	const block = lines.slice(range.start, range.end);
	const out = { summary: '', where: '' };
	for (let i = 0; i < block.length; i++) {
		const label = labelOf(block[i]);
		if (label === 'summary' || label === 'where') {
			const { text, end } = readLabelled(block, i);
			out[label] = text;
			i = end - 1;
		}
	}
	return out;
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif)$/i;

/** The filename at the end of a URL or path, for matching a hero to its caption. */
export function basename(url) {
	return String(url ?? '').split(/[?#]/)[0].split('/').pop();
}

/** A duration in whole minutes, for a run's footer. */
export function formatMinutes(ms) {
	const m = Math.round(ms / 60000);
	// A pass that took forty seconds did happen; "0m" reads as though it did not.
	return m === 0 ? '<1m' : `${m}m`;
}

/** `claude-opus-5-5` reads `Opus 5.5`. An id it does not recognise passes through. */
export function modelDisplayName(id) {
	if (!id) {
		return null;
	}
	const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id);
	if (!m) {
		return id;
	}
	return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

function parseSeverity(value) {
	const v = String(value ?? '').trim().toLowerCase();
	return ['major', 'moderate', 'minor'].includes(v) ? v : 'minor';
}

/**
 * Parses one `_explore: Opus 5.5 | $3.12 | 77/200 turns | 26m_` footer line.
 * Reports written before the model was recorded have no model bit.
 */
function parseCostLine(line) {
	const m = /^_([a-z]+):\s*(.*?)_$/.exec(line.trim());
	if (!m) {
		return null;
	}
	const pass = { label: m[1], model: null, cost: null, turns: null, maxTurns: null, duration: null };
	for (const bit of m[2].split('|').map(b => b.trim())) {
		const money = /^\$([\d.]+)$/.exec(bit);
		if (money) { pass.cost = `$${money[1]}`; continue; }
		const turns = /^(\d+)(?:\/(\d+))?\s*turns$/.exec(bit);
		if (turns) { pass.turns = turns[1]; pass.maxTurns = turns[2] ?? null; continue; }
		// `<1m` is how a pass under half a minute is written.
		const time = /^(<?[\dhms.]+)$/.exec(bit);
		if (time) { pass.duration = time[1]; continue; }
		if (bit) { pass.model = bit; }
	}
	return pass;
}

/**
 * Splits the status strip under a finding heading.
 *
 * `> **Confirmed** | Reproduced **3/3**`
 */
function parseStatusStrip(line) {
	const text = line.replace(/^>\s*/, '');
	const out = { confirmed: null, reproduced: null };
	if (/\bconfirmed\b/i.test(text)) { out.confirmed = 'Confirmed'; }
	if (/\bunproven\b/i.test(text)) { out.confirmed = 'Unproven'; }
	const rate = /Reproduced\s*\*\*([\d]+\/[\d]+)\*\*/i.exec(text) || /Reproduced\s*([\d]+\/[\d]+)/i.exec(text);
	if (rate) { out.reproduced = rate[1]; }
	return out;
}

/**
 * Splits `Step 3: <caption>` or `Variant: <caption>` into the step and the rest.
 * A range or a qualifier names the first step: `Steps 4-5:`, `Step 4, another
 * trigger: ...` and `Step 4 (cold replay): ...` all open from step 4.
 * The order sorts the gallery: steps by number, then variants, then untagged.
 * A caption may also name the ledger scenario that took the shot, another
 * run of the same bug: `S06: ...`, `Another run (S06): ...` or `... (S06)`.
 * The text keeps that name, so the caption still says which run it was.
 */
function splitStepTag(text) {
	const source = String(text ?? '');
	const scenario = /^\s*(?:another run\s*)?\(?(S\d{2,})\)?\s*[:.\u2014-]/i.exec(source)?.[1]
		?? /\((S\d{2,})\)/.exec(source)?.[1] ?? null;
	const m = /^\s*(?:steps?\s*(\d+)(?:\s*(?:-|\u2013|to|and|&)\s*\d+)?|(variant))(?:\s*[:.\u2014-]+\s*|,\s*(?=\S)|\s+(?=\())/i.exec(source);
	if (!m) {
		return { step: null, scenario: scenario?.toUpperCase() ?? null, text: source.trim() };
	}
	const step = m[1]
		? { label: `Step ${Number(m[1])}`, order: Number(m[1]) }
		: { label: 'Variant', order: Number.MAX_SAFE_INTEGER - 1 };
	return { step, scenario: scenario?.toUpperCase() ?? null, text: source.slice(m[0].length).trim() };
}

// `Verify <assertion> -> PASS` or `-> FAIL (finding K)`; the ledger's
// arrow and middle-dot forms read the same.
const STEP_RESULT = /^([\s\S]*?)\s*(?:->|=>|\u2192)\s*(PASS|FAIL)\b([\s\S]*)$/i;
const STEP_FIELD = /^(observed|evidence|log):\s*([\s\S]*)$/i;

/** `VERIFY The summary loads` becomes `Verify the summary loads`. */
function verifyText(text) {
	const shout = /^VERIFY\b:?\s*/.exec(text);
	if (!shout && /^(?:verify|check|confirm)\b/i.test(text)) {
		return text[0].toUpperCase() + text.slice(1);
	}
	const rest = shout ? text.slice(shout[0].length) : text;
	return `Verify ${rest.replace(/^(?:The|A|An|This|That|These|Those|Each|Every|All|No|Only)\b/, w => w.toLowerCase())}`;
}

/** `shots/a.png, [shots/b.png](shots/b.png)` as hrefs; a bare name is under shots/. */
function stepEvidence(text) {
	return String(text).split(/,\s*/).map(part => {
		const link = /\[[^\]]*\]\(([^)]+)\)/.exec(part);
		const raw = (link ? link[1] : part.replace(/`/g, '')).trim();
		const href = safeUrl(raw && !raw.includes('/') ? `shots/${raw}` : raw);
		return href && IMAGE_EXT.test(basename(href)) ? { href, file: basename(href) } : null;
	}).filter(Boolean);
}

/**
 * One step as `{ kind, md, result, finding, observed, evidence, log, rest }`,
 * from its lines. A step with no `-> PASS|FAIL` is a verify only when it says
 * so, and then carries no result: one that was never recorded is not invented.
 */
function parseStep(lines) {
	const head = String(lines[0] ?? '').trim();
	const step = { kind: 'action', md: head, result: null, finding: null, observed: '', evidence: [], log: '', logBody: [], error: null, rest: [] };
	const marked = STEP_RESULT.exec(head);
	if (marked) {
		step.kind = 'verify';
		step.md = verifyText(marked[1].trim());
		step.result = marked[2].toLowerCase();
		const finding = /finding\s*(\d+)/i.exec(marked[3]);
		const observed = /observed:\s*([\s\S]*?)\)?\s*$/i.exec(marked[3]);
		step.finding = step.result === 'fail' && finding ? Number(finding[1]) : null;
		step.observed = observed ? observed[1].trim() : '';
	} else if (/^(?:verify|check|confirm)\b/i.test(head)) {
		step.kind = 'verify';
		step.md = verifyText(head);
	}
	let fenced = false;
	let inLog = false;
	for (const line of lines.slice(1)) {
		// The message and stack sit indented under `Log:`, so they are its body.
		if (inLog && /^\s+\S/.test(line)) { step.logBody.push(line); continue; }
		inLog = false;
		const field = fenced ? null : STEP_FIELD.exec(line.trim());
		if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; }
		if (!field) { step.rest.push(line); continue; }
		const name = field[1].toLowerCase();
		if (name === 'evidence') { step.evidence.push(...stepEvidence(field[2])); }
		else if (name === 'observed') { step.observed = field[2].trim(); }
		else { step.log = field[2].trim(); inLog = true; }
	}
	step.logBody = outdent(step.logBody);
	step.error = parseLogField(step.log, step.logBody);
	while (step.rest.length && !step.rest[step.rest.length - 1].trim()) { step.rest.pop(); }
	// Only a failed check has an observation to report.
	if (step.result !== 'fail') { step.observed = ''; }
	return step;
}

/** A step with its markdown rendered. */
function typedStep(lines) {
	const step = parseStep(lines);
	return {
		...step,
		html: inline(step.md),
		// A step that runs to more than one line carries a block of its own --
		// the source to paste, usually -- so the rest is parsed as block markdown.
		blockHtml: step.rest.length ? block(widenOuterFence(step.rest.join('\n'))) : '',
		observedHtml: step.observed ? inline(step.observed) : '',
	};
}

/** A step as the agent prompt writes it: `Verify ... \u2192 FAIL (observed: ...)`. */
function stepText(step) {
	const result = !step.result ? ''
		: ` \u2192 ${step.result.toUpperCase()}${step.observed ? ` (observed: ${step.observed})` : ''}`;
	// The card has no place for a log line, so the prompt is where it goes.
	const log = step.log ? [`Log: ${step.log}`, ...step.logBody.map(l => `  ${l}`)] : [];
	return [step.md + result, ...step.rest, ...log].join('\n');
}

/**
 * Parses one Evidence bullet.
 *
 * A bullet that links an image becomes a thumbnail; one that names a log path
 * becomes a text tile. Anything else keeps its prose so nothing is dropped.
 */
function parseEvidenceBullet(text) {
	const link = /^\[([^\]]*)\]\(([^)]+)\)\s*(?:--|\u2014|-)?\s*([\s\S]*)$/.exec(text);
	if (link && IMAGE_EXT.test(basename(link[2]))) {
		// The extension says nothing about the scheme: `javascript:alert(1)//x.png`
		// ends in .png. This src is lifted out by hand rather than by the renderer,
		// so it needs the same guard the renderer applies.
		const src = safeUrl(link[2]);
		if (src) {
			const tagged = splitStepTag(link[3]);
			return {
				kind: 'shot',
				src,
				file: basename(src),
				step: tagged.step,
				...(tagged.scenario ? { scenario: tagged.scenario } : {}),
				caption: tagged.text || basename(src),
			};
		}
	}
	// `**Not logged** -- `<path>` | <window> -- "<expected line>"`: a line the run
	// looked for and did not find.
	const missing = /^\*\*Not logged\*\*\s*(?:--|\u2014|-)?\s*([\s\S]*)$/i.exec(text);
	const body = missing ? missing[1].trim() : text;
	const log = /^`([^`]+)`\s*((?:\|[^|]*?)*?)\s*(?:--|\u2014|-)?\s*((?:[`"\u201c][\s\S]*)?)$/.exec(body)
		?? /^`([^`]+)`()\s*(?:--|\u2014|-)?\s*([\s\S]*)$/.exec(body);
	if (log) {
		// The bullet reads `<path> | <process> | <when> -- "<quoted line>"`; older
		// reports add `, <note>` after the quote, kept apart so the row can drop it.
		//
		// The closing delimiter has to be the one that opened the span: a log line
		// quoted in backticks routinely contains double quotes of its own, and
		// closing on the first of those cut the message in half.
		const meta = log[2].split('|').map(p => p.trim()).filter(Boolean);
		const rest = log[3].trim();
		const quoted = /^([`"\u201c])([\s\S]*?)(?:\1|\u201d)\s*[,;]?\s*([\s\S]*)$/.exec(rest);
		const quote = quoted ? quoted[2].trim() : rest;
		const note = quoted ? quoted[3].trim() : '';
		// A time or a count has a digit; a process name has none.
		const when = meta.find(m => /\d/.test(m)) ?? '';
		return missing
			? { kind: 'missing', path: log[1], window: when, quote, note }
			: { kind: 'log', path: log[1], process: meta.find(m => !/\d/.test(m)) ?? '', when, quote, note };
	}
	return { kind: 'note', text };
}

/** False for a file the agent wrote (actions.log, saved notes): it says what the run did, not what Positron did. */
export function isPositronLog(path) {
	const file = String(path ?? '').replace(/:\d+$/, '');
	return /\.log$/i.test(file) && basename(file) !== 'actions.log';
}

const TEST_LEVEL = { unit: 'Unit', extension: 'Extension', e2e: 'E2E' };

/**
 * `at Fn (path/file.ts:212:7)`, `at path/file.ts:212`, or a Python traceback's
 * `File "path/file.py", line 212, in fn` -> its parts, or null.
 */
function parseFrame(line) {
	const py = /^File "([^"]+)", line (\d+)(?:, in (\S+))?\s*$/.exec(line.trim());
	if (py) {
		return { fn: py[3] ?? '', path: py[1], line: Number(py[2]) };
	}
	const m = /^at\s+(?:(.*?)\s+\(([^()]+?):(\d+)(?::\d+)?\)|([^\s()]+?):(\d+)(?::\d+)?)\s*$/.exec(line.trim());
	if (!m) {
		return null;
	}
	return m[2]
		? { fn: m[1], path: m[2], line: Number(m[3]) }
		: { fn: '', path: m[4], line: Number(m[5]) };
}

/**
 * Reads one `**Error output** -- `<log>` | <where> | <how often>` block and the
 * code block under it: the message first, then `at ...` frames.
 */
function readErrorOutput(lines, start) {
	const head = lines[start].trim().replace(/^\*\*[^*]+\*\*:?\s*(?:--|\u2014|-)?\s*/, '');
	const parts = head.split('|').map(p => p.trim()).filter(Boolean);
	const source = parts.length ? parts[0].replace(/^`|`$/g, '') : '';
	const meta = parts.slice(1);
	const body = [];
	let i = start + 1;
	while (i < lines.length && !lines[i].trim()) { i++; }
	if (/^\s*(?:```|~~~)/.test(lines[i] ?? '')) {
		for (i++; i < lines.length && !/^\s*(?:```|~~~)/.test(lines[i]); i++) {
			body.push(lines[i]);
		}
		i++;
	} else {
		for (; i < lines.length && /^(?:\s{4}|\t)/.test(lines[i]); i++) {
			body.push(lines[i]);
		}
	}
	return { error: errorFrom(source, meta, outdent(body)), end: i };
}

/** Lines less their shared indent, so a stack keeps its own nesting. */
function outdent(lines) {
	const widths = lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)[0].length);
	const cut = widths.length ? Math.min(...widths) : 0;
	const out = lines.map(l => l.slice(cut).replace(/\s+$/, ''));
	while (out.length && !out[out.length - 1]) { out.pop(); }
	return out;
}

/**
 * The fenced or indented block starting at the first non-blank line from
 * `from`, as a fenced block, with the index after it; null when there is none.
 */
function readSourceBlock(lines, from) {
	let k = from;
	while (k < lines.length && !lines[k].trim()) { k++; }
	const first = lines[k] ?? '';
	const fence = /^ {0,3}(`{3,}|~{3,})/.exec(first);
	if (!fence && !/^\s{4,}\S/.test(first)) { return null; }
	const body = [];
	if (fence) {
		body.push(first);
		for (k++; k < lines.length; k++) {
			body.push(lines[k]);
			const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[k]);
			if (close && close[1][0] === fence[1][0] && close[1].length >= fence[1].length) { k++; break; }
		}
		return { text: outdent(body).join('\n'), end: k };
	}
	for (; k < lines.length; k++) {
		const raw = lines[k];
		if (/^\s{4,}\S/.test(raw) || (!raw.trim() && /^\s{4,}\S/.test(lines[k + 1] ?? ''))) { body.push(raw); continue; }
		break;
	}
	return { text: widenOuterFence(['```', ...outdent(body), '```'].join('\n')), end: k };
}

/** An error from its log source, its `|` fields, and the message-then-frames body. */
function errorFrom(source, meta, body) {
	const message = [];
	const frames = [];
	for (const raw of body) {
		const text = raw.trim();
		if (!text) { continue; }
		const frame = parseFrame(text);
		// A Python traceback's header says nothing its frames do not.
		if (frame) { frames.push(frame); } else if (!frames.length && !/^Traceback \(most recent call last\):$/.test(text)) { message.push(text); }
	}
	const count = meta.map(m => /(\d+)\s*(?:\u00d7|x\b)/i.exec(m)).find(Boolean);
	return {
		source,
		meta,
		count: count ? Number(count[1]) : 1,
		message: message.join('\n'),
		frames,
		raw: body.join('\n'),
	};
}

/**
 * A ledger `Log: <file>:<line> | <process> | <count>` and the lines under it, or
 * null for `none found in ...` or a line with nothing under it.
 */
function parseLogField(head, body) {
	if (!head || /^none found\b/i.test(head) || !body.length) {
		return null;
	}
	const [source, ...meta] = head.split('|').map(p => p.trim().replace(/^`|`$/g, ''));
	// The ledger writes the bare count; the card reads it as "Logged 2x".
	const fields = meta.filter(Boolean).map(m => (/^\d+\s*[\u00d7x]/i.test(m) ? `Logged ${m}` : m));
	return errorFrom(source, fields, body);
}

/** Reads the `- ` bullets under a label, joining indented continuation lines. */
function readBullets(lines, start) {
	const items = [];
	let i = start + 1;
	for (; i < lines.length; i++) {
		const raw = lines[i];
		const text = raw.trim();
		if (!text) { continue; }
		if (/^[-*]\s/.test(text) && !/^\s{2,}/.test(raw)) {
			items.push(text.replace(/^[-*]\s+/, ''));
			continue;
		}
		if (items.length && /^\s{2,}\S/.test(raw)) {
			items[items.length - 1] += ` ${text}`;
			continue;
		}
		break;
	}
	return { items, end: i };
}

/**
 * `<case> -- Unit `path` (exists, covers ...)`. A line that does not parse
 * keeps its words as the case, so a loosely written suggestion still shows.
 */
function parseTestCase(text) {
	const m = /^([\s\S]*?)\s+(?:--|\u2014|->|\u2192)\s+(?:add to\s+)?(unit|extension|e2e)(?:\s+`([^`]+)`)?\s*(?:\(([^)]*)\))?\s*\.?$/i.exec(text);
	if (!m) {
		return { text: text.trim(), level: null, path: '', note: '' };
	}
	return { text: m[1].trim(), level: TEST_LEVEL[m[2].toLowerCase()], path: (m[3] ?? '').trim(), note: (m[4] ?? '').trim() };
}

/** A suggested case whose file does not exist yet: `(new file)`. */
export function isNewTestFile(testCase) {
	return /\bnew\b/i.test(testCase.note) && !/\bexists?\b/i.test(testCase.note);
}

/** `` `path` -- Unit, short note `` */
function parseRelatedTest(text) {
	const m = /^`([^`]+)`\s*(?:--|\u2014|-)?\s*(?:(unit|extension|e2e)\b[,;:\s]*)?([\s\S]*)$/i.exec(text);
	if (!m) {
		return null;
	}
	return { path: m[1].trim(), level: m[2] ? TEST_LEVEL[m[2].toLowerCase()] : null, note: m[3].trim() };
}

/**
 * Parses the body of one `### <n>. <claim>` block.
 */
function parseFindingBody(lines) {
	const out = {
		status: { confirmed: null, reproduced: null },
		summary: [],
		observed: '', expected: '', preconditions: [],
		feature: '',
		reproStart: '', steps: [],
		evidence: [],
		cause: '',
		errors: [],
		tests: { cases: [], related: [] },
		hero: null,
		opening: parseOpening(lines),
		matched: 0,
	};
	const opening = openingRange(lines);
	if (opening) {
		out.matched++;
	}
	for (let i = 0; i < lines.length; i++) {
		if (opening && i >= opening.start && i < opening.end) {
			i = opening.end - 1;
			continue;
		}
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) { continue; }

		if (trimmed.startsWith('>')) {
			out.status = parseStatusStrip(trimmed);
			out.matched++;
			continue;
		}
		const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(trimmed);
		if (img) {
			const src = safeUrl(img[2]);
			if (src) {
				out.hero = { src, alt: img[1], file: basename(src) };
			}
			out.matched++;
			continue;
		}
		const label = labelOf(trimmed);
		if (label === 'evidence') {
			out.matched++;
			for (let j = i + 1; j < lines.length; j++) {
				const bullet = lines[j].trim();
				if (!bullet) { continue; }
				// Reports written before Evidence lost its gallery embed one shot
				// above the bullets; the bullets after it are still Evidence.
				const image = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(bullet);
				if (image) {
					const src = safeUrl(image[2]);
					if (src) { out.hero = { src, alt: image[1], file: basename(src) }; }
					i = j;
					continue;
				}
				if (!/^[-*]\s/.test(bullet)) { i = j - 1; break; }
				const item = parseEvidenceBullet(bullet.replace(/^[-*]\s+/, ''));
				// Several log lines go in a code block under the bullet, as logged.
				const block = (item.kind === 'log' || item.kind === 'missing') && !item.quote ? readSourceBlock(lines, j + 1) : null;
				if (block) {
					item.quote = block.text.split('\n').slice(1, -1).join('\n');
					j = block.end - 1;
				}
				out.evidence.push(item);
				i = j;
			}
			continue;
		}
		if (label && /^repro\b/.test(label)) {
			// `**Repro** -- starting state: <text>`
			const start = /(?:--|\u2014|-)\s*starting state:\s*([\s\S]*)$/i.exec(trimmed);
			out.reproStart = start ? start[1].trim() : '';
			out.matched++;

			// A file the starting state needs is meant to sit under step 1, but
			// reports also paste it right under this line. Keep it with the
			// starting state rather than ending the steps before they begin.
			const source = readSourceBlock(lines, i + 1);
			if (source) {
				out.reproStart = `${out.reproStart}\n\n${source.text}`;
				i = source.end - 1;
			}

			// The preconditions line may sit between the Repro line and the steps,
			// which is where it reads best, or after Expected, which is where
			// older reports put it. Consume it here so it does not look like the
			// end of the list and take the steps with it.
			let scan = i + 1;
			while (scan < lines.length && !lines[scan].trim()) { scan++; }
			const early = labelOf(lines[scan] ?? '');
			if (['preconditions', 'configuration', 'only under'].includes(early)) {
				const { items, end } = readPreconditions(lines, scan);
				out.preconditions = items;
				i = end - 1;
			}

			// A step is its numbered line plus everything indented under it, which
			// is how a step that shows the source to paste is written. Stopping at
			// the first line that was not itself numbered dropped the code block
			// and then fed the remaining steps into the summary, so a finding's
			// opening paragraph ended with "2. Render the cell. 3. Click Show
			// Details."
			let step = null;
			let fenced = false;
			let j = i + 1;
			for (; j < lines.length; j++) {
				const raw = lines[j];
				const text = raw.trim();
				const indented = /^\s{2,}\S/.test(raw);
				const numbered = /^\d+\.\s+([\s\S]*)$/.exec(text);

				if (fenced) {
					if (/^(?:```|~~~)/.test(text)) { fenced = false; }
					step.push(dedent(raw));
					continue;
				}
				if (numbered && !indented) {
					step = [numbered[1]];
					out.steps.push(step);
					continue;
				}
				if (step && indented) {
					if (/^(?:```|~~~)/.test(text)) { fenced = true; }
					step.push(dedent(raw));
					continue;
				}
				// A blank line belongs to the step only when the block continues
				// under it; otherwise it ends the list.
				if (!text && step && /^\s{2,}\S/.test(lines[j + 1] ?? '')) {
					step.push('');
					continue;
				}
				if (!text) { continue; }
				break;
			}
			i = j - 1;
			continue;
		}
		// `Only under` and `Configuration` are what this was called before. The
		// first read backwards in the case that actually occurs -- "Only under
		// shipped defaults" describes a bug you could avoid by changing a
		// setting -- but reports already published use them.
		if (label === 'observed' || label === 'expected'
			|| label === 'preconditions' || label === 'configuration' || label === 'only under') {
			if (label === 'observed' || label === 'expected') {
				const { text, end } = readLabelled(lines, i);
				out[label] = text;
				i = end - 1;
			} else {
				const { items, end } = readPreconditions(lines, i);
				out.preconditions = items;
				i = end - 1;
			}
			out.matched++;
			continue;
		}
		// Fields a finding no longer has; an older report's lines are read and dropped.
		if (label === 'impact' || label === 'affects' || label === 'workaround') {
			out.matched++;
			continue;
		}
		if (label === 'feature') {
			out.feature = trimmed.replace(/^\*\*[^*]+:\*\*\s*/, '');
			out.matched++;
			continue;
		}
		if (label === 'error output') {
			const { error, end } = readErrorOutput(lines, i);
			out.errors.push(error);
			out.matched++;
			i = end - 1;
			continue;
		}
		// `Regression test` is what this was called before.
		if (label === 'test gap' || label === 'regression test' || label === 'regression tests') {
			const { items, end } = readBullets(lines, i);
			out.tests.cases.push(...items.map(parseTestCase));
			out.matched++;
			i = end - 1;
			continue;
		}
		if (label && /^other tests\b/.test(label)) {
			const { items, end } = readBullets(lines, i);
			out.tests.related.push(...items.map(parseRelatedTest).filter(Boolean));
			out.matched++;
			i = end - 1;
			continue;
		}
		if (label && /^cause\b/.test(label)) {
			const { text, end } = readLabelled(lines, i);
			out.cause = text;
			out.matched++;
			i = end - 1;
			continue;
		}
		// Anything left before the first label is the finding's summary prose.
		out.summary.push(trimmed);
	}
	return out;
}

/**
 * Parses a `<details>` block into its summary title and inner lines.
 */
function readDetails(lines, title) {
	for (let i = 0; i < lines.length; i++) {
		if (!/^<details/.test(lines[i].trim())) { continue; }
		const summary = /<summary>([\s\S]*?)<\/summary>/.exec(lines[i + 1] ?? '');
		if (!summary || summary[1].trim().toLowerCase() !== title.toLowerCase()) { continue; }
		const close = lines.findIndex((l, n) => n > i && /^<\/details>/.test(l.trim()));
		return lines.slice(i + 2, close === -1 ? lines.length : close);
	}
	return null;
}

/** Splits Run details into its `### Subsection` parts. */
function parseRunDetails(lines) {
	if (!lines) { return null; }
	const sections = [];
	let current = null;
	for (const line of lines) {
		const heading = /^###\s+(.*)$/.exec(headingText(line));
		if (heading) {
			current = { title: heading[1].trim(), body: [] };
			sections.push(current);
			continue;
		}
		if (current) { current.body.push(line); }
	}
	return sections
		.map(s => ({ title: s.title, html: block(s.body.join('\n')) }))
		.filter(s => s.html);
}

/** Splits Verification details into its preamble, verdict chips and body. */
function parseVerification(lines) {
	if (!lines) { return null; }
	const verdicts = [];
	const body = [];
	let preamble = '';
	let linked = new Map();
	const change = new Set();
	for (const line of lines) {
		const trimmed = line.trim();
		// The change mark in the Findings table carries these.
		if (/^CHANGE:/i.test(trimmed)) {
			for (const part of trimmed.slice(trimmed.indexOf(':') + 1).split(';')) {
				const m = /^(\d+)\s*=\s*related$/i.exec(part.trim());
				if (m) { change.add(Number(m[1])); }
			}
			continue;
		}
		// The findings carry the matches; as a line here it would only repeat them.
		if (/^KNOWN:/i.test(trimmed)) {
			continue;
		}
		// The Linked issues rows carry these.
		if (/^LINKED:/i.test(trimmed)) {
			linked = parseLinked(trimmed);
			continue;
		}
		if (/^VERDICTS:/i.test(trimmed)) {
			for (const part of trimmed.slice(trimmed.indexOf(':') + 1).split(';')) {
				const m = /^(\d+)\s*=\s*(.+)$/.exec(part.trim());
				if (!m) { continue; }
				const verdict = m[2].trim().toUpperCase();
				const word = verdict.startsWith('CONFIRMED') ? 'confirmed'
					: verdict.startsWith('FALSE') ? 'disputed'
						: verdict.startsWith('UNRESOLVED') ? 'unresolved' : null;
				if (word) { verdicts.push({ n: Number(m[1]), word }); }
			}
			continue;
		}
		if (!preamble && trimmed && !trimmed.startsWith('#')) {
			preamble = trimmed;
			continue;
		}
		body.push(line);
	}
	return { preambleHtml: preamble ? inline(preamble) : '', verdicts, linked, change, bodyHtml: block(body.join('\n')) };
}

/**
 * Pulls the screenshot reference out of a Coverage `Result` cell.
 *
 * Reports written before the Screenshot column existed put the link inside the
 * sentence. Taking the last image link out of the cell recovers it; the rest of
 * the sentence is left alone.
 */
function splitResultCell(result) {
	let text = result;
	let shot = null;
	const links = [...result.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)]
		.filter(m => IMAGE_EXT.test(basename(m[2])));
	if (links.length) {
		const last = links[links.length - 1];
		const href = safeUrl(last[2]);
		if (href) {
			shot = { href, label: basename(href) };
		}
		text = result.slice(0, last.index) + result.slice(last.index + last[0].length);
	}
	return { text: text.replace(/\s{2,}/g, ' ').trim(), shot };
}

/**
 * Finds the finding a Coverage row is reporting, so the row can link to it.
 *
 * Written as `(finding 3)` today; a middle-dot form is also accepted so the
 * rendered wording and the markdown can converge later.
 */
function splitFindingRef(text) {
	const m = /\s*[(\u00b7]\s*finding\s+(\d+)\s*\)?\s*$/i.exec(text);
	if (!m) {
		return { text: text.trim(), finding: null };
	}
	return { text: text.slice(0, m.index).replace(/[\s,;.\u00b7-]+$/, '').trim(), finding: Number(m[1]) };
}

// A ledger field separator: the middle dot the example uses, or ASCII ` - ` / ` | `.
const LEDGER_SEP = /\s+(?:·|-|\|)\s+/;

/**
 * The ledger Environment's first line, `Positron <version> build <n>, <build>
 * (Code - OSS <v>), on <OS> (<platform>).`, as the issue's Positron and OS
 * bullets; null for any other line. The Positron bullet keeps only the commit
 * of its build, and Run details still has the Code - OSS version.
 */
export function parseSystemLine(text) {
	const m = /^Positron\s+(.+),\s+on\s+(.+?)\.?$/.exec(String(text ?? '').trim().replace(/^[-*]\s+/, ''));
	if (!m) {
		return null;
	}
	const [version, ...build] = m[1].replace(/\s*\(Code - OSS[^)]*\)/i, '').split(/,\s*/);
	const commit = /\b([0-9a-f]{7,40})\b/i.exec(build.join(', '))?.[1];
	const os = m[2].trim();
	return {
		positron: `${version.trim()}${commit ? ` (\`${commit}\`)` : ''}`,
		os: /^not recorded$/i.test(os) ? 'not recorded' : os,
	};
}

/**
 * A scenario's `Issue: #5678 observed` line, as `{ n, kind }` with kind
 * observed, held, failed or back; null for anything else.
 */
function ledgerIssue(text) {
	const m = /^#(\d+)\s+(observed|came back|fix held|fix did not hold|fix didn't hold)\b/i.exec(text.trim());
	if (!m) {
		return null;
	}
	const word = m[2].toLowerCase();
	const kind = word === 'observed' ? 'observed' : word === 'came back' ? 'back' : word === 'fix held' ? 'held' : 'failed';
	return { n: Number(m[1]), kind };
}

/** A Not run reason naming a linked issue: `Already filed as #5412`, `Fix for #6040 not exercised: ...`. */
function notRunIssue(reason) {
	const skipped = /^already filed as #(\d+)/i.exec(reason);
	if (skipped) {
		return [{ n: Number(skipped[1]), kind: 'skipped' }];
	}
	const fix = /^fix for #(\d+) not exercised\b/i.exec(reason);
	return fix ? [{ n: Number(fix[1]), kind: 'not-exercised' }] : [];
}

/**
 * Parses the run's `ledger.md` into Coverage rows, or null when it holds no
 * scenarios. Scenarios are `## S01 · <name>` blocks with `Status:`, `Result:`,
 * optional `Preconditions:` bullets (`- <name> | <creating ID> | <how>`) and
 * numbered typed `Steps:`; `## Noticed` holds notes on what the run saw and did not
 * check, which stay in the ledger and are not rendered; `## Not run` lists `- N01 · <name> · <reason>`;
 * `## Files` lists `- files/<path> | <what it is> | <scenarios and findings>`.
 */
export function parseLedger(markdown) {
	const lines = String(markdown ?? '').split('\n');
	const exercised = [];
	const notExercised = [];
	const noticed = [];
	const logs = [];
	const files = [];
	const environment = [];
	let cur = null;
	let section = '';
	let inNotRun = false;
	let inNoticed = false;
	let inLogs = false;
	let inFiles = false;
	let inEnvironment = false;
	for (const line of lines) {
		const t = line.trim();
		const head = /^##\s+(.*)$/.exec(headingText(line));
		if (head) {
			cur = null;
			section = '';
			inNotRun = /^not run$/i.test(head[1].trim());
			inNoticed = /^noticed$/i.test(head[1].trim());
			inLogs = /^logs$/i.test(head[1].trim());
			inFiles = /^files$/i.test(head[1].trim());
			inEnvironment = /^environment$/i.test(head[1].trim());
			const m = /^(S\d+)\s*(?:·|-|\||:)\s*(.+)$/.exec(head[1].trim());
			if (m) {
				cur = { id: m[1], name: m[2].trim(), status: '', finding: null, result: '', pre: [], stepLines: [], issues: [] };
				exercised.push(cur);
			}
			continue;
		}
		if (inEnvironment) {
			if (t && t !== '---') { environment.push(line); }
			continue;
		}
		if (inLogs) {
			// `- logs/<file> | <source> | <note>`; the parenthetical under the heading is not a file.
			const m = /^[-*]\s+(.+)$/.exec(t);
			if (m) {
				const [path, source = '', ...note] = m[1].split(/\s*\|\s*/);
				const entry = { path: path.trim().replace(/^`|`$/g, ''), source: source.trim(), note: note.join(' | ').trim() };
				logs.push({ ...entry, sourceHtml: inline(entry.source), noteHtml: inline(entry.note) });
			}
			continue;
		}
		if (inFiles) {
			// `- files/<path> | <what it is> | <who uses it>`, the same shape as a log line.
			const m = /^[-*]\s+(.+)$/.exec(t);
			if (m) {
				const [path, desc = '', ...uses] = m[1].split(/\s*\|\s*/);
				const entry = { path: path.trim().replace(/^`|`$/g, '').replace(/^\.\//, ''), desc: desc.trim(), uses: uses.join(' | ').trim() };
				files.push({ ...entry, descHtml: inline(entry.desc), usesHtml: inline(entry.uses) });
			}
			continue;
		}
		if (inNoticed) {
			const m = /^[-*]\s+(?:(O\d+)\s*(?:·|-|\||:)\s*)?(.+)$/.exec(t);
			if (m) {
				const sep = LEDGER_SEP.exec(m[2]);
				noticed.push({ id: m[1] ?? '', name: (sep ? m[2].slice(0, sep.index) : m[2]).trim() });
			}
			continue;
		}
		if (inNotRun) {
			const m = /^[-*]\s+(?:(N\d+)\s*(?:·|-|\||:)\s*)?(.+)$/.exec(t);
			if (m) {
				const sep = LEDGER_SEP.exec(m[2]);
				const name = sep ? m[2].slice(0, sep.index) : m[2];
				const reason = sep ? m[2].slice(sep.index + sep[0].length) : '';
				notExercised.push({ id: m[1] ?? '', name: name.trim(), reason: reason.trim(), issues: notRunIssue(reason) });
			}
			continue;
		}
		if (!cur) { continue; }
		const field = /^(status|result|preconditions|steps|issue):\s*(.*)$/i.exec(t);
		if (field && !/^\s/.test(line)) {
			const name = field[1].toLowerCase();
			if (name === 'issue') {
				const issue = ledgerIssue(field[2]);
				if (issue) { cur.issues.push(issue); }
				continue;
			}
			if (name === 'status') {
				cur.status = /fail/i.test(field[2]) ? 'fail' : 'pass';
				// "Finding 1, Finding 2" and "Findings 1, 2" both name two.
				cur.findings = [...field[2].matchAll(/findings?\s*(\d+(?:\s*(?:,|and|&)\s*(?:finding\s*)?\d+)*)/gi)]
					.flatMap(m => m[1].match(/\d+/g).map(Number));
				cur.finding = cur.findings[0] ?? null;
			} else if (name === 'result') {
				cur.result = field[2].trim();
			}
			section = name;
			continue;
		}
		if (section === 'preconditions' && /^[-*]\s+/.test(t)) {
			const [pname, from = '', ...how] = t.replace(/^[-*]\s+/, '').split(/\s*\|\s*/);
			cur.pre.push({ name: pname.trim(), from: from.trim(), how: how.join(' | ').trim() });
		} else if (section === 'steps' && t !== '---') {
			cur.stepLines.push(line);
		}
	}
	if (!exercised.length && !notExercised.length && !logs.length && !files.length) {
		return null;
	}

	const rows = exercised.map(s => {
		// A numbered line opens a step; its indented lines are its fields and source.
		const groups = [];
		for (const line of s.stepLines) {
			const m = /^\d+[.)]\s+(.*)$/.exec(line);
			if (m) { groups.push([m[1]]); }
			else if (groups.length) { groups[groups.length - 1].push(dedent(line)); }
		}
		const steps = groups.map(typedStep);
		const finding = s.finding ?? steps.find(st => st.finding)?.finding ?? null;
		return {
			id: s.id,
			scenarioHtml: inline(s.name),
			scenario: plainText(s.name),
			resultHtml: inline(sentenceCase(s.result)),
			status: s.status || (steps.some(st => st.result === 'fail') ? 'fail' : 'pass'),
			finding,
			findings: s.findings ?? [],
			issues: s.issues,
			shot: null,
			pre: s.pre.map(p => ({ nameHtml: inline(p.name), from: p.from, howHtml: inline(p.how) })),
			steps,
		};
	});
	return {
		exercised: rows,
		notExercised: notExercised.map(r => ({
			id: r.id,
			scenarioHtml: inline(r.name),
			reasonHtml: inline(sentenceCase(r.reason)),
			reason: plainText(r.reason),
			issues: r.issues,
		})),
		// A ledger always lists what it did not run, so an empty list means none.
		notExercisedListed: true,
		logs,
		files,
		environment,
	};
}

function withMetaHtml(e) {
	// A letter x sits on the baseline where a multiplication sign floats; the
	// span keeps it lowercase inside an uppercase label.
	return { ...e, metaHtml: e.meta.map(m => inline(m).replace(/(\d+)\s*(?:x\b|\u00d7)/g, '<span class="n-x">$1x</span>')) };
}

/** Scenario tallies for the tile, from Coverage rows. */
function scenarioCounts({ exercised, notExercised }) {
	const issue = r => r.status === 'fail' || Boolean(r.finding);
	return {
		exercised: exercised.length,
		pass: exercised.filter(r => !issue(r)).length,
		issues: exercised.filter(issue).length,
		notRun: notExercised.length,
	};
}

/** Which lines sit inside a fenced code block, fence lines included. */
function fenceMask(lines) {
	let fence = null;
	return lines.map(line => {
		const m = /^\s*(`{3,}|~{3,})/.exec(line);
		if (m && !fence) { fence = m[1]; return true; }
		// A closing fence carries no info string, so ```python inside stays open.
		if (m && m[1][0] === fence?.[0] && m[1].length >= fence.length && !line.slice(m.index + m[0].length).trim()) { fence = null; return true; }
		return fence !== null;
	});
}

/**
 * Parses a report's markdown into the structure the template renders. Given
 * the run's ledger, Coverage and the Coverage tile come from it instead of
 * the report's Coverage tables.
 */
export function parseReport(markdown, { ledger } = {}) {
	const lines = String(markdown ?? '').split('\n');
	// A `## ` line in a pasted cell is source, not a section.
	const fenced = fenceMask(lines);

	const titleIndex = lines.findIndex(l => l.startsWith('# '));
	const rawTitle = titleIndex === -1 ? 'Exploratory test' : lines[titleIndex].slice(2).trim();
	const title = rawTitle.replace(/^Exploratory test:\s*/i, '');

	// The line under the title is `<branch>` | `<sha>`. Look for it only in the
	// header, between the title and whatever comes first of a summary label or a
	// section: searching the whole document meant a report that omitted the line
	// put backticks from some finding's body in the header instead.
	const headerEnd = lines.findIndex((l, i) =>
		i > titleIndex && !fenced[i] && (/^##\s/.test(headingText(l)) || /^\*\*[^*]+:\*\*/.test(l.trim())));
	const metaIndex = lines.findIndex((l, i) =>
		i > titleIndex && (headerEnd === -1 || i < headerEnd) && l.trim().startsWith('`'));
	const chips = metaIndex === -1
		? []
		: [...lines[metaIndex].matchAll(/`([^`]+)`/g)].map(m => m[1]);
	// `PR: <owner>/<repo>#<n>`, only when the run was for one. Strict, because
	// it becomes a link: nothing but a GitHub owner, repo and number gets through.
	// Searched to the first section rather than the first label: written bold,
	// the line is a label itself.
	const sectionStart = lines.findIndex((l, i) => i > titleIndex && !fenced[i] && /^##\s/.test(headingText(l)));
	const prLine = lines.find((l, i) => i > titleIndex && (sectionStart === -1 || i < sectionStart)
		&& /^(\*\*)?PR:/.test(l.trim()));
	const prMatch = prLine && /^(?:\*\*)?PR:(?:\*\*)?\s*`?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#(\d+)`?\s*$/.exec(prLine.trim());
	const pr = prMatch
		? { number: Number(prMatch[3]), url: `https://github.com/${prMatch[1]}/${prMatch[2]}/pull/${prMatch[3]}` }
		: undefined;

	const firstSection = lines.findIndex((l, i) => !fenced[i] && l.startsWith('## '));
	const labels = new Map();
	lines.forEach((line, i) => {
		if (i > titleIndex && (firstSection === -1 || i < firstSection) && /^\*\*[^*]+:\*\*/.test(line.trim())) {
			const key = (/^\*\*([^*]+):\*\*/.exec(line.trim()) || [])[1].toLowerCase();
			labels.set(key, line.trim().replace(/^\*\*[^*]+:\*\*\s*/, ''));
		}
	});

	// The scope sentence introduces Coverage, where the scenario count is the
	// row count of the table directly below it. Repeating the number in the
	// sentence made the reader check one against the other for no reason.
	//
	// `Tested` is written as a phrase completing its label; standing on its own
	// above the table it has to read as a sentence, so it gets a capital and a
	// full stop.
	const scopePhrase = (labels.get('tested') ?? '').replace(/,\s*\d+\s+scenarios?\s*$/i, '').trim();
	const scope = scopePhrase
		? sentenceCase(scopePhrase) + (/[.!?]$/.test(scopePhrase) ? '' : '.')
		: '';

	const findingsTable = findTable(lines, h => h.includes('#') && h.includes('finding'));
	const byNumber = new Map();
	for (const row of findingsTable?.rows ?? []) {
		const n = Number(row['#']);
		if (!Number.isInteger(n)) { continue; }
		byNumber.set(n, row);
	}

	// Findings run from `## Findings` to the next `##`.
	const findingsStart = lines.findIndex(l => /^##\s+Findings\s*$/i.test(headingText(l)));
	const findingsEnd = findingsStart === -1
		? -1
		: lines.findIndex((l, i) => i > findingsStart && !fenced[i] && /^##\s/.test(headingText(l)));
	const findingsLines = findingsStart === -1
		? []
		: lines.slice(findingsStart, findingsEnd === -1 ? lines.length : findingsEnd);

	// `### 1. <claim>` in practice; `### Finding 1: <claim>` is what the skill
	// documented. Both are accepted so older reports keep rendering.
	const HEADING = /^###\s+(?:Finding\s+)?(\d+)\s*[.:)]?\s*(.*)$/i;
	const starts = [];
	findingsLines.forEach((line, i) => {
		const m = !fenced[findingsStart + i] && HEADING.exec(headingText(line));
		if (m) { starts.push({ i, n: Number(m[1]), claim: m[2].trim() }); }
	});

	const findings = starts.map((start, idx) => {
		const end = idx + 1 < starts.length ? starts[idx + 1].i : findingsLines.length;
		const bodyLines = findingsLines.slice(start.i + 1, end);
		const parsed = parseFindingBody(bodyLines);
		const row = byNumber.get(start.n) ?? {};
		const reproduced = parsed.status.reproduced || (row['reproduction'] ?? '').trim();
		const verified = (row['verified'] ?? '').toLowerCase();

		// The embedded shot and the Evidence bullets are two citations of one set
		// of screenshots, so they are folded into one gallery: Evidence is where a
		// reader looks for proof, and the same image appearing twice in a card
		// reads as two pieces of evidence rather than one.
		if (parsed.hero) {
			const match = parsed.evidence.find(e => e.kind === 'shot' && e.file === parsed.hero.file);
			const embedded = splitStepTag(parsed.hero.alt || '');
			if (match) {
				// Both cite it, so keep the fuller description: one of the two is
				// usually a short label written to sit in a list.
				if (embedded.text.length > match.caption.length) {
					match.caption = embedded.text;
				}
				match.step = match.step ?? embedded.step;
				if (!match.scenario && embedded.scenario) { match.scenario = embedded.scenario; }
				match.featured = true;
			} else {
				// Embedded but never cited. It is the shot chosen to show the failure
				// best, so it leads the untagged ones.
				parsed.evidence.unshift({
					kind: 'shot',
					src: parsed.hero.src,
					file: parsed.hero.file,
					step: embedded.step,
					...(embedded.scenario ? { scenario: embedded.scenario } : {}),
					caption: embedded.text || parsed.hero.file,
					featured: true,
				});
			}
		}
		// The starting state and the configuration line are both answers to
		// "what has to be true before step 1", so they render as one list.
		// `<short name> | <full text>`, as the ledger writes them; older reports have no name.
		const named = [parsed.reproStart, ...parsed.preconditions]
			.map(t => String(t ?? '').trim())
			.filter(t => t && !isDefaultsOnly(t))
			.map(t => {
				const m = /^([^|\n]+?)\s+\|\s+(\S[\s\S]*)$/.exec(t);
				return m && m[1].split(/\s+/).length <= 6 ? { name: m[1], text: sentenceCase(m[2]) } : { name: '', text: sentenceCase(t) };
			});
		const preconditions = named.map(p => p.text);

		const steps = parsed.steps.map(typedStep);
		const stepOf = new Map();
		steps.forEach((step, k) => step.evidence.forEach(e => {
			if (!stepOf.has(e.file)) { stepOf.set(e.file, { label: `Step ${k + 1}`, order: k + 1 }); }
		}));
		// Another scenario's shot of the bug, captioned with that scenario and no
		// step on this card, shows the failure again: it opens from the step that fails.
		const failing = steps.findIndex(st => st.result === 'fail' && st.finding === start.n);
		const failAt = failing !== -1 ? failing : steps.findIndex(st => st.result === 'fail');
		for (const e of parsed.evidence.filter(e => e.kind === 'shot' && e.scenario && !stepOf.has(e.file))) {
			const order = e.step?.order;
			if (failAt !== -1 && !(Number.isInteger(order) && order >= 1 && order <= steps.length)) {
				e.step = { label: `Step ${failAt + 1}`, order: failAt + 1 };
			}
		}
		// A shot a step cites is evidence whether or not a bullet repeats it, so
		// every check's picture reaches the gallery.
		const cited = new Set(parsed.evidence.filter(e => e.kind === 'shot').map(e => e.file));
		for (const step of steps) {
			for (const e of step.evidence.filter(e => !cited.has(e.file))) {
				cited.add(e.file);
				parsed.evidence.push({ kind: 'shot', src: e.href, file: e.file, caption: plainText(step.md) });
			}
		}
		// Screenshots in step order, so they read like the repro. Within a step,
		// the shots its own Evidence: line cites come first, in that order: the
		// step's icon opens on the one that shows its check, and any extra follows.
		// Logs and notes keep their order after them. Sort is stable.
		const order = e => (stepOf.get(e.file) ?? e.step)?.order ?? Number.MAX_SAFE_INTEGER;
		const citedAt = e => {
			const k = steps[order(e) - 1]?.evidence.findIndex(x => x.file === e.file) ?? -1;
			return k === -1 ? Number.MAX_SAFE_INTEGER : k;
		};
		const shots = parsed.evidence.filter(e => e.kind === 'shot').sort((a, b) => order(a) - order(b) || citedAt(a) - citedAt(b));
		parsed.evidence = [...shots, ...parsed.evidence.filter(e => e.kind !== 'shot')];

		return {
			n: start.n,
			title: start.claim,
			feature: parsed.feature,
			// The table's claim is written to be scanned in a row; the heading's is
			// written to open a card. Both are in the markdown, so both get used.
			rowTitle: row['finding'] ? inline(row['finding']) : inline(start.claim),
			severity: parseSeverity(row['severity']),
			reproduced,
			// Unproven is 0/M by definition, so the rate settles it when no strip was written.
			confirmed: parsed.status.confirmed ?? (/^0\//.test(reproduced) ? 'Unproven' : reproduced ? 'Confirmed' : null),
			verified: ['confirmed', 'disputed', 'unresolved'].includes(verified) ? verified : null,
			// Issues the verifier says may already describe this finding. Advisory.
			known: [...new Set([...(row['known'] ?? '').matchAll(/#(\d+)/g)].map(m => Number(m[1])))],
			summaryHtml: parsed.summary.length ? inline(parsed.summary.join(' ')) : '',
			// The edit pass's opening: the card leads with its summary, and the issue with all of it.
			observedHtml: parsed.observed ? inline(parsed.observed) : '',
			expectedHtml: parsed.expected ? inline(parsed.expected) : '',
			// A starting state with a pasted file is the one multi-line item.
			preconditions: preconditions.map(t => (t.includes('\n') ? block(t) : inline(t))),
			preconditionNames: named.map(p => (p.name ? inline(p.name) : '')),
			steps,
			// A shot a step names is that step's, whatever its caption says.
			evidence: parsed.evidence.map(e => (e.kind === 'shot'
				? { ...e, step: stepOf.get(e.file) ?? e.step, caption: sentenceCase(e.caption), captionHtml: inline(sentenceCase(e.caption)) }
				: e)),
			causeHtml: parsed.cause ? inline(parsed.cause) : '',
			errors: parsed.errors.map(withMetaHtml),
			tests: {
				cases: parsed.tests.cases.map(c => ({ ...c, textHtml: inline(c.text), noteHtml: c.note ? inline(c.note) : '' })),
				related: parsed.tests.related.map(r => ({ ...r, noteHtml: r.note ? inline(r.note) : '' })),
			},
			hero: parsed.hero,
			// The same fields as plain markdown, for the copyable agent prompt: built
			// from this parse rather than the rendered card, so the two cannot disagree.
			text: {
				observed: parsed.observed ?? '',
				expected: parsed.expected ?? '',
				preconditions,
				steps: steps.map(stepText),
				cause: parsed.cause ?? '',
				summary: parsed.summary.join(' '),
				opening: parsed.opening,
				prose: parsed.matched === 0 ? bodyLines.join('\n').trim() : '',
			},
			// Nothing recognisable in the body: render it as prose rather than
			// showing an empty card.
			proseHtml: parsed.matched === 0 ? block(bodyLines.join('\n')) : '',
		};
	});

	// Coverage. `Exercised` is the new heading; `Verified` is what older
	// reports wrote.
	const coverageStart = lines.findIndex(l => /^##\s+Coverage\s*$/i.test(headingText(l)));
	const coverageEnd = coverageStart === -1
		? -1
		: lines.findIndex((l, i) => i > coverageStart && !fenced[i] && (/^##\s/.test(headingText(l)) || /^<details/.test(l.trim())));
	const coverageTo = coverageEnd === -1 ? lines.length : coverageEnd;
	const notExercisedHeading = coverageStart === -1
		? -1
		: lines.findIndex((l, i) => i > coverageStart && i < coverageTo && /^###\s+Not exercised\s*$/i.test(headingText(l)));
	const exercisedTo = notExercisedHeading === -1 ? coverageTo : notExercisedHeading;

	const exercisedTable = coverageStart === -1
		? null
		: findTable(lines, h => h.includes('scenario') && h.includes('result'), coverageStart, exercisedTo);
	const notExercisedTable = notExercisedHeading === -1
		? null
		: findTable(lines, h => h.includes('scenario'), notExercisedHeading, coverageTo);

	const exercised = (exercisedTable?.rows ?? []).filter(row => !isPlaceholder(row['scenario'])).map(row => {
		const raw = row['result'] ?? '';
		// A Screenshot column is authoritative; without one the link is still
		// inside the sentence, where reports used to put it.
		const column = (row['screenshot'] ?? '').trim();
		const split = column ? { text: raw, shot: null } : splitResultCell(raw);
		const ref = splitFindingRef(split.text);
		let shot = split.shot;
		if (column) {
			const link = /\[([^\]]*)\]\(([^)]+)\)/.exec(column);
			const raw = link ? link[2] : (isPlaceholder(column) ? '' : column);
			const href = safeUrl(raw);
			if (href) { shot = { href, label: basename(href) }; }
		}
		// Steps are one cell, split on `<br>`: a table cell cannot hold a list.
		// An `Observed:` or `Evidence:` item belongs to the step before it.
		const groups = [];
		for (const item of String(row['steps'] ?? '').split(/<br\s*\/?>/i)) {
			const t = item.trim().replace(/^\d+[.)]\s*/, '');
			if (!t || isPlaceholder(t)) { continue; }
			if (STEP_FIELD.test(t) && groups.length) { groups[groups.length - 1].push(t); }
			else { groups.push([t]); }
		}
		const steps = groups.map(typedStep);
		// The Screenshot column proves the last check when no step names its own.
		if (shot && !steps.some(st => st.evidence.length)) {
			const last = steps.findLast(st => st.kind === 'verify') ?? steps[steps.length - 1];
			last?.evidence.push({ href: shot.href, file: shot.label });
		}
		return {
			scenarioHtml: inline(row['scenario'] ?? ''),
			// Plain, for the lightbox caption and the screenshot's label.
			scenario: plainText(row['scenario']),
			resultHtml: inline(sentenceCase(ref.text)),
			// A failed check names its finding even when the Result does not.
			finding: ref.finding ?? steps.find(st => st.finding)?.finding ?? null,
			shot,
			steps,
		};
	});

	const notExercised = (notExercisedTable?.rows ?? []).filter(row => !isPlaceholder(row['scenario'])).map(row => ({
		scenarioHtml: inline(row['scenario'] ?? ''),
		reasonHtml: inline(sentenceCase(row['reason'] ?? row._cells?.[1] ?? '')),
		reason: plainText(row['reason'] ?? row._cells?.[1] ?? ''),
	}));

	const fromLedger = parseLedger(ledger);
	const coverage = fromLedger && (fromLedger.exercised.length || fromLedger.notExercised.length)
		? fromLedger
		// Whether the report wrote a Not exercised heading at all, so an empty one
		// can say so rather than vanish.
		: { exercised, notExercised, notExercisedListed: notExercisedHeading !== -1 };

	// A finding whose report wrote no Error output takes the errors its ledger
	// checks logged, so the log a check cited reaches the card and the prompt.
	for (const f of findings) {
		if (f.errors.length) { continue; }
		const logged = [...f.steps, ...coverage.exercised.flatMap(r => r.steps).filter(st => st.finding === f.n)]
			.map(st => st.error).filter(Boolean);
		// The finding's repro usually repeats the ledger step, Log and all.
		const seen = new Set();
		f.errors = logged.filter(e => !seen.has(`${e.source}\n${e.message}`) && seen.add(`${e.source}\n${e.message}`))
			.map(withMetaHtml);
	}

	let runDetails = parseRunDetails(readDetails(lines, 'Run details'));
	// The ledger's Environment is the run-wide setup, so Run details shows it
	// rather than the report repeating it. A report that wrote its own keeps it.
	const environment = fromLedger?.environment?.length ? block(fromLedger.environment.join('\n')) : '';
	if (environment && !runDetails?.some(s => /^environment$/i.test(s.title))) {
		const sections = runDetails ?? [];
		const at = sections.findIndex(s => /^change under test$/i.test(s.title)) + 1;
		sections.splice(at, 0, { title: 'Environment', html: environment });
		runDetails = sections;
	}
	const verification = parseVerification(readDetails(lines, 'Verification details'));

	const passes = lines.map(parseCostLine).filter(Boolean);
	const main = passes.find(p => p.label === 'explore') ?? passes[0] ?? null;
	const total = passes.find(p => p.label === 'total');
	const billed = passes.filter(p => p.label !== 'total');

	// The lead's emphasis is the agent's: it is the only thing in the pipeline
	// that watched the run, so it is the only thing that knows which clause is
	// the point. A `**...**` covering most of the sentence emphasises nothing,
	// so it is dropped rather than rendered.
	const result = labels.get('result') ?? '';
	const emphasised = [...result.matchAll(/\*\*([\s\S]+?)\*\*/g)]
		.reduce((sum, m) => sum + m[1].length, 0);
	const lead = emphasised > result.replace(/\*/g, '').length * 0.8
		? result.replace(/\*\*/g, '')
		: result;

	// A run can report findings in the table without a block for each, or the
	// other way round, so the count is the union. The breakdown reads the table,
	// which is where severity is written: counting the blocks meant a report
	// that listed five findings and wrote up none showed no severities at all.
	const numbers = new Set([...byNumber.keys(), ...findings.map(f => f.n)]);
	const findingCount = numbers.size;
	const severityCounts = { major: 0, moderate: 0, minor: 0 };
	for (const n of numbers) {
		const severity = String(byNumber.get(n)?.severity ?? '').trim().toLowerCase();
		// Only the three known words count, so a missing column leaves the
		// breakdown empty rather than reporting every finding as minor.
		if (severity in severityCounts) {
			severityCounts[severity]++;
		}
	}

	return {
		title,
		chips,
		pr,
		leadHtml: lead ? inline(lead) : '',
		scopeHtml: scope ? inline(scope) : '',
		findings,
		severityCounts,
		findingCount,
		coverage,
		scenarios: scenarioCounts(coverage),
		runDetails,
		logs: fromLedger?.logs ?? [],
		files: fromLedger?.files ?? [],
		// The ledger's Environment as written, for the issue's System details.
		environment: fromLedger?.environment ?? [],
		verification,
		// The total's duration covers every pass. Falling back to the main pass
		// only matters for a report written before the total carried one. A run
		// with one pass, such as one with no findings to verify, writes no total.
		cost: {
			passes: billed,
			total: total?.cost ?? (billed.length === 1 ? billed[0].cost : null),
			duration: total?.duration ?? main?.duration ?? null,
		},
	};
}
