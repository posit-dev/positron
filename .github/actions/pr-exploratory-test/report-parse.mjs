/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Turns the report markdown into structured data the template can lay out on
// purpose. The old renderer handed the whole body to marked and styled the
// result, which meant nothing below the header was understood: Observed could
// not sit beside Expected, and a screenshot could not become a thumbnail,
// because by then it was all just <p> and <li>.
//
// Every field here is something the agent already writes. Where a field cannot
// be recovered, the parser keeps the prose rather than dropping it: a finding
// whose labels do not match falls back to `proseHtml`, and the template renders
// that instead of the structured blocks.

import { Marked } from 'marked';

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
export function sentenceCase(text) {
	const s = String(text ?? '');
	if (!/^[a-z]/.test(s)) {
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

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif)$/i;

/** The filename at the end of a URL or path, for matching a hero to its caption. */
export function basename(url) {
	return String(url ?? '').split(/[?#]/)[0].split('/').pop();
}

/**
 * Normalizes the `Introduced?` column into the origin the meta line shows.
 *
 * `unclear` lands on "Not checked" with the other unsettled cases: all three
 * mean the report is not claiming the change caused this, and the meta line has
 * one quiet slot for that rather than a shade for each.
 */
export function parseOrigin(value) {
	const v = String(value ?? '').trim().toLowerCase();
	if (/^yes/.test(v)) {
		return { kind: 'new', label: 'New in this change' };
	}
	if (/^no/.test(v)) {
		return { kind: 'pre-existing', label: 'Pre-existing' };
	}
	return { kind: 'unchecked', label: 'Not checked' };
}

export function parseSeverity(value) {
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
 * `> **Confirmed** | Reproduced **3/3** | **Introduced by this change**`
 */
function parseStatusStrip(line) {
	const text = line.replace(/^>\s*/, '');
	const out = { confirmed: null, reproduced: null, origin: null };
	if (/\bconfirmed\b/i.test(text)) { out.confirmed = 'Confirmed'; }
	if (/\bunproven\b/i.test(text)) { out.confirmed = 'Unproven'; }
	const rate = /Reproduced\s*\*\*([\d]+\/[\d]+)\*\*/i.exec(text) || /Reproduced\s*([\d]+\/[\d]+)/i.exec(text);
	if (rate) { out.reproduced = rate[1]; }
	if (/introduced by this change/i.test(text)) { out.origin = { kind: 'new', label: 'New in this change' }; }
	else if (/pre-existing/i.test(text)) { out.origin = { kind: 'pre-existing', label: 'Pre-existing' }; }
	else if (/origin unclear/i.test(text)) { out.origin = { kind: 'unchecked', label: 'Not checked' }; }
	return out;
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
			return {
				kind: 'shot',
				src,
				file: basename(src),
				caption: link[3].trim() || basename(src),
			};
		}
	}
	const log = /^`([^`]+)`\s*(?:--|\u2014|-)?\s*([\s\S]*)$/.exec(text);
	if (log) {
		// The bullet usually reads `<path> -- "<quoted line>", <note>`. Keeping the
		// quote and the note apart lets the tile show the line that proves the
		// behaviour without the surrounding sentence competing with it.
		//
		// The closing delimiter has to be the one that opened the span: a log line
		// quoted in backticks routinely contains double quotes of its own, and
		// closing on the first of those cut the message in half.
		const rest = log[2].trim();
		const quoted = /^([`"\u201c])([\s\S]*?)(?:\1|\u201d)\s*[,;]?\s*([\s\S]*)$/.exec(rest);
		return {
			kind: 'log',
			path: log[1],
			quote: quoted ? quoted[2].trim() : rest,
			note: quoted ? quoted[3].trim() : '',
		};
	}
	return { kind: 'note', text };
}

/**
 * Parses the body of one `### <n>. <claim>` block.
 */
function parseFindingBody(lines) {
	const out = {
		status: { confirmed: null, reproduced: null, origin: null },
		summary: [],
		observed: '', expected: '', preconditions: '',
		reproStart: '', steps: [],
		evidence: [],
		cause: '',
		hero: null,
		matched: 0,
	};
	for (let i = 0; i < lines.length; i++) {
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
				if (!/^[-*]\s/.test(bullet)) { i = j - 1; break; }
				out.evidence.push(parseEvidenceBullet(bullet.replace(/^[-*]\s+/, '')));
				i = j;
			}
			continue;
		}
		if (label && /^repro\b/.test(label)) {
			// `**Repro** -- starting state: <text>`
			const start = /(?:--|\u2014|-)\s*starting state:\s*([\s\S]*)$/i.exec(trimmed);
			out.reproStart = start ? start[1].trim() : '';
			out.matched++;

			// The preconditions line may sit between the Repro line and the steps,
			// which is where it reads best, or after Expected, which is where
			// older reports put it. Consume it here so it does not look like the
			// end of the list and take the steps with it.
			let scan = i + 1;
			while (scan < lines.length && !lines[scan].trim()) { scan++; }
			const early = labelOf(lines[scan] ?? '');
			if (['preconditions', 'configuration', 'only under'].includes(early)) {
				const { text: value, end } = readLabelled(lines, scan);
				out.preconditions = value;
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
			const { text, end } = readLabelled(lines, i);
			const key = label === 'observed' || label === 'expected' ? label : 'preconditions';
			out[key] = text;
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
		const heading = /^###\s+(.*)$/.exec(line.trim());
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
	for (const line of lines) {
		const trimmed = line.trim();
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
	return { preambleHtml: preamble ? inline(preamble) : '', verdicts, bodyHtml: block(body.join('\n')) };
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

/**
 * Parses a report's markdown into the structure the template renders.
 */
export function parseReport(markdown) {
	const lines = String(markdown ?? '').split('\n');

	const titleIndex = lines.findIndex(l => l.startsWith('# '));
	const rawTitle = titleIndex === -1 ? 'Exploratory test' : lines[titleIndex].slice(2).trim();
	const title = rawTitle.replace(/^Exploratory test:\s*/i, '');

	// The line under the title is `<branch>` | `<sha>`. Look for it only in the
	// header, between the title and whatever comes first of a summary label or a
	// section: searching the whole document meant a report that omitted the line
	// put backticks from some finding's body in the header instead.
	const headerEnd = lines.findIndex((l, i) =>
		i > titleIndex && (/^##\s/.test(l.trim()) || /^\*\*[^*]+:\*\*/.test(l.trim())));
	const metaIndex = lines.findIndex((l, i) =>
		i > titleIndex && (headerEnd === -1 || i < headerEnd) && l.trim().startsWith('`'));
	const chips = metaIndex === -1
		? []
		: [...lines[metaIndex].matchAll(/`([^`]+)`/g)].map(m => m[1]);

	const firstSection = lines.findIndex(l => l.startsWith('## '));
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
	const findingsStart = lines.findIndex(l => /^##\s+Findings\s*$/i.test(l.trim()));
	const findingsEnd = findingsStart === -1
		? -1
		: lines.findIndex((l, i) => i > findingsStart && /^##\s/.test(l.trim()));
	const findingsLines = findingsStart === -1
		? []
		: lines.slice(findingsStart, findingsEnd === -1 ? lines.length : findingsEnd);

	// `### 1. <claim>` in practice; `### Finding 1: <claim>` is what the skill
	// documented. Both are accepted so older reports keep rendering.
	const HEADING = /^###\s+(?:Finding\s+)?(\d+)\s*[.:)]?\s*(.*)$/i;
	const starts = [];
	findingsLines.forEach((line, i) => {
		const m = HEADING.exec(line.trim());
		if (m) { starts.push({ i, n: Number(m[1]), claim: m[2].trim() }); }
	});

	const findings = starts.map((start, idx) => {
		const end = idx + 1 < starts.length ? starts[idx + 1].i : findingsLines.length;
		const bodyLines = findingsLines.slice(start.i + 1, end);
		const parsed = parseFindingBody(bodyLines);
		const row = byNumber.get(start.n) ?? {};
		const origin = parsed.status.origin ?? parseOrigin(row['introduced?'] ?? row['introduced']);
		const verified = (row['verified'] ?? '').toLowerCase();

		// The embedded shot and the Evidence bullets are two citations of one set
		// of screenshots, so they are folded into one gallery: Evidence is where a
		// reader looks for proof, and the same image appearing twice in a card
		// reads as two pieces of evidence rather than one.
		if (parsed.hero) {
			const match = parsed.evidence.find(e => e.kind === 'shot' && e.file === parsed.hero.file);
			if (match) {
				// Both cite it, so keep the fuller description: one of the two is
				// usually a short label written to sit in a list.
				const embedded = parsed.hero.alt || '';
				if (embedded.length > match.caption.length) {
					match.caption = embedded;
				}
				match.featured = true;
			} else {
				// Embedded but never cited. It is the shot chosen to show the failure
				// best, so it leads the gallery.
				parsed.evidence.unshift({
					kind: 'shot',
					src: parsed.hero.src,
					file: parsed.hero.file,
					caption: parsed.hero.alt || parsed.hero.file,
					featured: true,
				});
			}
		}

		return {
			n: start.n,
			title: start.claim,
			// The table's claim is written to be scanned in a row; the heading's is
			// written to open a card. Both are in the markdown, so both get used.
			rowTitle: row['finding'] ? inline(row['finding']) : inline(start.claim),
			impact: row['impact'] ? inline(sentenceCase(row['impact'])) : '',
			severity: parseSeverity(row['severity']),
			origin,
			reproduced: parsed.status.reproduced || (row['reproduction'] ?? '').trim(),
			confirmed: parsed.status.confirmed,
			verified: ['confirmed', 'disputed', 'unresolved'].includes(verified) ? verified : null,
			summaryHtml: parsed.summary.length ? inline(parsed.summary.join(' ')) : '',
			observedHtml: parsed.observed ? inline(parsed.observed) : '',
			expectedHtml: parsed.expected ? inline(parsed.expected) : '',
			// The starting state and the configuration line are both answers to
			// "what has to be true before step 1", so they render as one list.
			preconditions: [parsed.reproStart, parsed.preconditions]
				.map(t => String(t ?? '').trim())
				.filter(t => t && !isDefaultsOnly(t))
				.map(t => inline(sentenceCase(t))),
			// A step that runs to more than one line carries a block of its own --
			// the source to paste, usually -- so it is parsed as block markdown.
			steps: parsed.steps.map(lines => (lines.length > 1
				? block(widenOuterFence(lines.join('\n')))
				: inline(lines[0] ?? ''))),
			evidence: parsed.evidence.map(e => (e.kind === 'shot'
				? { ...e, caption: sentenceCase(e.caption), captionHtml: inline(sentenceCase(e.caption)) }
				: e.kind === 'log'
					? { ...e, quoteHtml: inline(e.quote), noteHtml: e.note ? inline(sentenceCase(e.note)) : '' }
					: { ...e, textHtml: inline(sentenceCase(e.text)) })),
			causeHtml: parsed.cause ? inline(parsed.cause) : '',
			hero: parsed.hero,
			// Nothing recognisable in the body: render it as prose rather than
			// showing an empty card.
			proseHtml: parsed.matched === 0 ? block(bodyLines.join('\n')) : '',
		};
	});

	// Coverage. `Exercised` is the new heading; `Verified` is what older
	// reports wrote.
	const coverageStart = lines.findIndex(l => /^##\s+Coverage\s*$/i.test(l.trim()));
	const coverageEnd = coverageStart === -1
		? -1
		: lines.findIndex((l, i) => i > coverageStart && (/^##\s/.test(l.trim()) || /^<details/.test(l.trim())));
	const coverageTo = coverageEnd === -1 ? lines.length : coverageEnd;
	const notExercisedHeading = coverageStart === -1
		? -1
		: lines.findIndex((l, i) => i > coverageStart && i < coverageTo && /^###\s+Not exercised\s*$/i.test(l.trim()));
	const exercisedTo = notExercisedHeading === -1 ? coverageTo : notExercisedHeading;

	const exercisedTable = coverageStart === -1
		? null
		: findTable(lines, h => h.includes('scenario') && h.includes('result'), coverageStart, exercisedTo);
	const notExercisedTable = notExercisedHeading === -1
		? null
		: findTable(lines, h => h.includes('scenario'), notExercisedHeading, coverageTo);

	const exercised = (exercisedTable?.rows ?? []).map(row => {
		const raw = row['result'] ?? '';
		// A Screenshot column is authoritative; without one the link is still
		// inside the sentence, where reports used to put it.
		const column = (row['screenshot'] ?? '').trim();
		const split = column ? { text: raw, shot: null } : splitResultCell(raw);
		const ref = splitFindingRef(split.text);
		let shot = split.shot;
		if (column) {
			const link = /\[([^\]]*)\]\(([^)]+)\)/.exec(column);
			const raw = link ? link[2] : (column === '-' || column === '\u2014' ? '' : column);
			const href = safeUrl(raw);
			if (href) { shot = { href, label: basename(href) }; }
		}
		return {
			scenarioHtml: inline(row['scenario'] ?? ''),
			resultHtml: inline(sentenceCase(ref.text)),
			finding: ref.finding,
			shot,
		};
	});

	const notExercised = (notExercisedTable?.rows ?? []).map(row => ({
		scenarioHtml: inline(row['scenario'] ?? ''),
		reasonHtml: inline(sentenceCase(row['reason'] ?? row._cells?.[1] ?? '')),
	}));

	const runDetails = parseRunDetails(readDetails(lines, 'Run details'));
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
		leadHtml: lead ? inline(lead) : '',
		scopeHtml: scope ? inline(scope) : '',
		findings,
		severityCounts,
		findingCount,
		coverage: { exercised, notExercised },
		scenarios: {
			exercised: exercised.length,
			pass: exercised.filter(r => !r.finding).length,
			issues: exercised.filter(r => r.finding).length,
			notRun: notExercised.length,
		},
		runDetails,
		verification,
		// The total's duration covers every pass. Falling back to the main pass
		// only matters for a report written before the total carried one.
		cost: {
			passes: billed,
			total: total?.cost ?? null,
			duration: total?.duration ?? main?.duration ?? null,
		},
	};
}
