/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Parses the ledger the explorer writes as it goes: its scenarios and steps,
// their Log: lines and the errors under them, Not run, Logs, Files and
// Environment.

import { basename, block, inline, plainText, safeUrl, sentenceCase } from './text.mjs';

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

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif)$/i;

// `Verify <assertion> -> PASS` or `-> FAIL (finding K)`; the ledger's
// arrow and middle-dot forms read the same.
const STEP_RESULT = /^([\s\S]*?)\s*(?:->|=>|\u2192)\s*(PASS|FAIL)\b([\s\S]*)$/i;
const STEP_FIELD = /^(observed|evidence|log):\s*([\s\S]*)$/i;

/** `VERIFY The summary loads` becomes `Verify the summary loads`. */
export function verifyText(text) {
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

/** False for a file the agent wrote (actions.log, saved notes): it says what the run did, not what Positron did. */
export function isPositronLog(path) {
	const file = String(path ?? '').replace(/:\d+$/, '');
	return /\.log$/i.test(file) && basename(file) !== 'actions.log';
}

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

/** Lines less their shared indent, so a stack keeps its own nesting. */
function outdent(lines) {
	const widths = lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)[0].length);
	const cut = widths.length ? Math.min(...widths) : 0;
	const out = lines.map(l => l.slice(cut).replace(/\s+$/, ''));
	while (out.length && !out[out.length - 1]) { out.pop(); }
	return out;
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
export function parseLogField(head, body) {
	if (!head || /^none found\b/i.test(head) || !body.length) {
		return null;
	}
	const [source, ...meta] = head.split('|').map(p => p.trim().replace(/^`|`$/g, ''));
	// The ledger writes the bare count; the card reads it as "Logged 2x".
	const fields = meta.filter(Boolean).map(m => (/^\d+\s*[\u00d7x]/i.test(m) ? `Logged ${m}` : m));
	return errorFrom(source, fields, body);
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
