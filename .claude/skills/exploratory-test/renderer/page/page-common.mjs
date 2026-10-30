/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// What the page and the finding card's actions both use: icons, labels, the
// skill's version and the small text helpers that keep report text safe in
// HTML and markdown.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOWERCASE_NAMES, safeUrl } from '../shared/text.mjs';

export const ICON = {
	// Straight down with no tray under it: "jump down the page", not "download".
	arrow: '<svg class="tile-arrow" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9"></path><path d="M4.5 9l3.5 3.5L11.5 9"></path></svg>',
	check: size => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>`,
	// The check alone carries the green, so its stroke comes from CSS rather than
	// currentColor, which is the body-coloured word beside it.
	x: '<span class="ki-x"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"></path></svg></span>',
	copy: '<svg class="cp-ico" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"></rect><path d="M3 10.5V4.1c0-.6.5-1.1 1.1-1.1h6.4"></path></svg>',
	// The simplified bug: four legs, no centre line, drawn level with Copy's top edge.
	bug: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
		+ '<path d="M6.2 5.1a1.8 1.8 0 0 1 3.6 0"/><rect x="4.75" y="5.5" width="6.5" height="8" rx="3.25"/>'
		+ '<path d="M4.75 8.6H2.5M13.5 8.6h-2.25M4.9 11.7 3 13M11.1 11.7 13 13"/></svg>',
	link: '<svg class="ln-ico" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8"></path><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"></path></svg>',
	linked: '<svg class="ln-ok" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>',
	copied: '<svg class="cp-ok" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"></path></svg>',
	down: '<svg class="cov-chev" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>',
	// The collapsed rows' and the Coverage rows' disclosure: 12px, right-pointing.
	disclose: cls => `<svg class="${cls}" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5-4.5 4.5"></path></svg>`,
	chevron: '<svg class="chev" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5-4.5 4.5"></path></svg>',
	// A picture frame: "this step has a screenshot".
	photo: '<svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="3" width="12" height="10" rx="1.5"></rect><path d="M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5"></path></svg>',
	// Leaves the report.
	external: '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h6.5V10"></path><path d="M12.5 3.5L4 12"></path></svg>',
	prev: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"></path></svg>',
	next: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"></path></svg>',
	close: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
	up: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3.5"></path><path d="M4 7.5l4-4 4 4"></path></svg>',
	moon: '<svg class="th-moon" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z"></path></svg>',
	sun: '<svg class="th-sun" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.8"></circle><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"></path></svg>',
};

export const SEVERITY_LABEL = { major: 'Major', moderate: 'Moderate', minor: 'Minor' };

export const REPO_URL = 'https://github.com/posit-dev/positron';

export function capitalize(text) {
	// A name written in lowercase (polars, pandas) keeps its case.
	return text && !LOWERCASE_NAMES.has(/^[\w.-]+/.exec(text)?.[0]) ? text[0].toUpperCase() + text.slice(1) : text;
}

/** A finding's status, lowercase: the verifier's verdict over the run's own. */
export function statusWord(f) {
	return f.verified ?? (f.confirmed ? f.confirmed.toLowerCase() : null);
}

/** `/a/b`, `~/x` and URLs stand as written; anything else is relative to `base`. */
export function absolutePath(p, base) {
	if (!base || /^([a-z][a-z0-9+.-]*:|\/|~)/i.test(p)) {
		return p;
	}
	return /^https?:\/\//i.test(base)
		? new URL(p, base.endsWith('/') ? base : `${base}/`).href
		: resolvePath(base, p);
}

/**
 * A log source that names a file beside the report, `logs/x.log:1182`, as
 * `{ path, line }`; null for prose, an absolute path, or one leaving the folder.
 */
export function logFile(source) {
	const m = /^([^\s`:]+?)(?::(\d+))?$/.exec(String(source ?? '').trim());
	if (!m || /^([a-z][a-z0-9+.-]*:|\/|~|\.\.)/i.test(m[1]) || !/\.\w+$/.test(m[1])) {
		return null;
	}
	return { path: m[1].replace(/^\.\//, ''), line: m[2] ? Number(m[2]) : null };
}

/** `Logged 2x (after each Retry)` -> `2x after each Retry`. */
export function countText(meta) {
	return String(meta ?? '').replace(/^logged\s+/i, '').replace(/\(([^)]*)\)/g, '$1').replace(/(\d)\s*(?:x\b|\u00d7)/g, '$1x').trim();
}

/**
 * A link whose URL the card would refuse keeps its words and loses the URL
 * here too, so the copied prompt carries nothing the page would not render.
 */
export function safeLinks(text) {
	return String(text ?? '').replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
		(whole, bang, label, url) => (safeUrl(url) ? whole : label));
}

/** A lone ~ escaped outside code, so GitHub does not strike through "(~L12) ... (~L40)". */
export function escapeLoneTildes(text) {
	return text.split(/(^(`{3,})[^\n]*\n[\s\S]*?^\2[ \t]*$|`[^`\n]*`)/m).map((part, i) => {
		// split puts each match and its fence group in the odd slots.
		return i % 3 === 0 ? part.replace(/(?<![~\\])~(?!~)/g, '\\~') : i % 3 === 1 ? part : '';
	}).join('');
}

/**
 * The skill's version, the `version:` in SKILL.md's frontmatter, as the
 * feedback form gets it: `1.0`, which the footer shows as `v1.0`. Null when
 * there is none. Given the text for a test; read beside the
 * renderer otherwise.
 */
export function skillVersion(skillMd) {
	try {
		const text = skillMd ?? readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'SKILL.md'), 'utf8');
		const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
		const version = /^\s+version:\s*["']?v?([^"'\s]+)["']?\s*$/m.exec(front)?.[1];
		return version ?? null;
	} catch {
		return null;
	}
}

/**
 * A page script's copy of `value` (a script expression), calling `done` (a
 * function name) once it is on the clipboard. A frame that blocks the
 * clipboard API can still allow execCommand, so that is the fallback.
 */
export function copyScript(value, done) {
	return `function fallback(){var ta=document.createElement('textarea');ta.value=${value};ta.setAttribute('readonly','');
ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
var ok=false;try{ok=document.execCommand('copy');}catch(e){}ta.remove();if(ok){${done}();}}
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(${value}).then(${done},fallback);}
else{fallback();}`;
}
