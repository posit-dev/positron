/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The files a repro depends on: the ledger's `## Files`, saved under `files/`
// beside the report. A finding names a file; the page turns the name into a
// link that opens a viewer with Copy and Download, and the agent prompt carries
// the file's text. The text is embedded in the page, so Copy and Download keep
// working when only the HTML is forwarded; `files/<path>` is the fallback.

import { escapeHtml, basename } from './report-parse.mjs';

// The viewer shows this many lines; Download has the rest.
export const PREVIEW_LINES = 400;
// Text over this size is not embedded: Download links the file instead.
export const EMBED_BYTES = 200 * 1024;

const TYPE = {
	qmd: 'Quarto', rmd: 'R Markdown', ipynb: 'Notebook', py: 'Python', r: 'R', jl: 'Julia',
	sql: 'SQL', csv: 'CSV', tsv: 'TSV', json: 'JSON', jsonl: 'JSON Lines', toml: 'TOML',
	yml: 'YAML', yaml: 'YAML', md: 'Markdown', txt: 'Text', sh: 'Shell', html: 'HTML',
	js: 'JavaScript', ts: 'TypeScript', parquet: 'Parquet', feather: 'Feather', arrow: 'Arrow',
	sqlite: 'SQLite', db: 'Database', duckdb: 'DuckDB', xlsx: 'Excel', xls: 'Excel', rds: 'RDS',
	png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG',
};

// The fence language for the agent prompt, where it differs from the extension.
const FENCE = { py: 'python', r: 'r', rmd: 'rmd', sh: 'bash', yml: 'yaml', jl: 'julia', ipynb: 'json', txt: '' };

/**
 * A file a precondition or step can name: a basename or a relative path ending
 * in a data or source extension. Setting keys such as `positron.r.x` are not
 * one, since a word follows the extension.
 */
export const FILE_NAME = /(?<![\w/.:@-])((?:[\w-]+\/)*[\w-][\w.-]*\.(?:qmd|rmd|ipynb|py|r|jl|sql|csv|tsv|jsonl?|toml|ya?ml|md|txt|parquet|feather|arrow|sqlite|db|duckdb|xlsx?|rds|rdata|sh))(?!\w|\.\w)/gi;

function extOf(path) {
	const m = /\.([^./]+)$/.exec(path);
	return m ? m[1].toLowerCase() : '';
}

/** `files/a/b.py` -> `file-a-b-py`, unique within the page. */
function makeId(path, taken) {
	const stem = `file-${path.replace(/^files\//, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
	let id = stem;
	for (let k = 2; taken.has(id); k++) { id = `${stem}-${k}`; }
	taken.add(id);
	return id;
}

/** UTF-8 text, or null for bytes that are not: a NUL, or an invalid sequence. */
function decodeText(bytes) {
	if (bytes.subarray(0, 8000).includes(0)) {
		return null;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

/** A cell's label: Markdown, Raw, or the kernel's language. */
function cellLabel(cell, lang) {
	if (cell.cell_type === 'markdown') { return 'Markdown'; }
	if (cell.cell_type !== 'code') { return 'Raw'; }
	return TYPE[lang] ?? (lang ? lang[0].toUpperCase() + lang.slice(1) : 'Code');
}

/**
 * A notebook's cells as `{ kind, label, lines }`, and its language; null when
 * the text is not a notebook. Outputs are left out: the repro reruns the cells.
 */
function parseNotebook(text) {
	let nb;
	try {
		nb = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(nb?.cells)) {
		return null;
	}
	const meta = nb.metadata ?? {};
	const lang = String(meta.kernelspec?.language ?? meta.language_info?.name ?? 'python').toLowerCase();
	const key = { python: 'py', r: 'r', julia: 'jl' }[lang] ?? lang;
	const cells = nb.cells.map(c => {
		const source = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
		const kind = c.cell_type === 'markdown' || c.cell_type === 'code' ? c.cell_type : 'raw';
		return { kind, label: cellLabel(c, key), lines: source.replace(/\n$/, '').split('\n') };
	});
	return { lang: key, cells };
}

/**
 * The cells as Jupytext's percent format, which reads as a script: code as is,
 * markdown commented out, each under its `# %%` marker.
 */
function notebookScript(nb) {
	return nb.cells.map(c => (c.kind === 'code'
		? ['# %%', ...c.lines]
		: [`# %% [${c.kind}]`, ...c.lines.map(l => (l ? `# ${l}` : '#'))]).join('\n')).join('\n\n');
}

function sizeText(bytes) {
	if (bytes < 1024) { return `${bytes} B`; }
	if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`; }
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The ledger's file entries with what the page needs to show each one.
 * `readFile(path)` returns the bytes of a path relative to the run directory,
 * or null when it is not there; without it every file counts as missing.
 */
export function resolveFiles(entries, readFile) {
	const taken = new Set();
	return (entries ?? []).map(e => {
		const bytes = readFile ? readFile(e.path) : null;
		const ext = extOf(e.path);
		const base = { ...e, name: basename(e.path), id: makeId(e.path, taken), ext, type: TYPE[ext] ?? (ext ? ext.toUpperCase() : 'File') };
		if (!bytes) {
			return { ...base, kind: 'missing' };
		}
		const text = decodeText(bytes);
		if (text === null) {
			return { ...base, kind: 'binary', size: bytes.length };
		}
		const lines = text.replace(/\n$/, '').split('\n');
		return {
			...base,
			kind: 'text',
			// A notebook shows as its cells; one that does not parse shows as text.
			notebook: ext === 'ipynb' ? parseNotebook(text) : null,
			size: bytes.length,
			lineCount: text === '' ? 0 : lines.length,
			preview: lines.slice(0, PREVIEW_LINES),
			// Over the cap, Copy is left out and Download is the file itself.
			text: bytes.length <= EMBED_BYTES ? text : null,
		};
	});
}

/** The entry a name in a finding refers to: its path, its path under `files/`, or its file name. */
export function findFile(files, ref) {
	const r = String(ref ?? '').trim().replace(/^\.\//, '');
	const bare = r.replace(/^files\//, '');
	return files.find(f => f.path === r || f.path === `files/${bare}`)
		?? files.find(f => f.name === basename(bare))
		?? null;
}

/** Every entry a piece of markdown names, by its path or file name, in list order. */
export function filesNamedIn(files, markdown) {
	const text = String(markdown ?? '');
	const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return files.filter(f => [f.path, f.name].some(n => new RegExp(`(?<![\\w/.-])${esc(n)}(?!\\w|\\.\\w)`).test(text)));
}

function metaText(f) {
	if (f.notebook) {
		const n = f.notebook.cells.length;
		return `${f.type} \u00b7 ${n} ${n === 1 ? 'cell' : 'cells'}`;
	}
	if (f.kind === 'text') { return `${f.type} · ${f.lineCount} ${f.lineCount === 1 ? 'line' : 'lines'}`; }
	if (f.kind === 'binary') { return `${f.type} · ${sizeText(f.size)}`; }
	return f.type;
}

/**
 * A `files/<path>` written as plain text, as a ledger precondition does, as a
 * "view <name>" link to the viewer. Text inside a tag, a link or code is left.
 */
export function linkFilePaths(html, files) {
	if (!files.length) {
		return html;
	}
	let skip = 0;
	return String(html ?? '').split(/(<[^>]+>)/).map(part => {
		if (part.startsWith('<')) {
			if (/^<(a|code)\b/i.test(part)) { skip++; }
			else if (/^<\/(a|code)>/i.test(part)) { skip = Math.max(0, skip - 1); }
			return part;
		}
		return skip ? part : part.replace(/(?<![\w/.-])(files\/[\w./-]*\.\w+)(?!\w|\.\w)/g, (whole, path) => {
			const f = findFile(files, path);
			return f && f.kind !== 'missing'
				? `<a class="fn-view" href="${escapeHtml(f.path)}" data-file="${f.id}">view ${escapeHtml(f.name)}</a>`
				: whole;
		});
	}).join('');
}

/** The file name as a link that opens the viewer; plain code when the file is not there. */
export function fileChip(f) {
	if (f.kind === 'missing') {
		return `<code>${escapeHtml(f.name)}</code>`;
	}
	return `<a class="fn" href="${escapeHtml(f.path)}" data-file="${f.id}" title="Open ${escapeHtml(f.path.replace(/^files\//, ''))}">${escapeHtml(f.name)}</a>`;
}

/**
 * Rendered HTML with each saved file it names turned into a chip: a code span
 * holding exactly a file's name or path, or a link to `files/<path>`. A code
 * span with anything else in it, such as `%run -i slow.py`, stays code.
 */
export function linkFiles(html, files) {
	if (!files.length) {
		return html;
	}
	const unescape = t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
	return String(html ?? '')
		.replace(/<a href="(files\/[^"]+)"[^>]*>[\s\S]*?<\/a>/g, (whole, href) => {
			const f = findFile(files, unescape(href));
			return f ? fileChip(f) : whole;
		})
		.replace(/<code>([^<]+)<\/code>/g, (whole, name) => {
			// Only a span that is a name and nothing else; a listed file of any type.
			const t = unescape(name).trim();
			const f = /^[\w./-]+$/.test(t) ? findFile(files, t) : null;
			return f ? fileChip(f) : whole;
		});
}

const ICON = {
	copy: '<svg class="cp-ico" aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"></rect><path d="M3 10.5V4.1c0-.6.5-1.1 1.1-1.1h6.4"></path></svg>',
	download: '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8"></path><path d="M4.5 7.5L8 11l3.5-3.5"></path><path d="M3 13.5h10"></path></svg>',
	close: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
};

/**
 * The file's exact text for Copy and Download. Raw inside a script element
 * unless something in it would end or bend the element (a closing script tag,
 * a comment opener) or the parser would rewrite it (a carriage return): then
 * base64, so what comes out is byte for byte what went in.
 */
function sourceBlock(f) {
	const raw = !/<\/script|<!--|\r/i.test(f.text);
	const body = raw ? f.text : Buffer.from(f.text, 'utf8').toString('base64');
	return `<script type="text/plain" id="src-${f.id}"${raw ? '' : ' data-enc="base64"'}>${body}</script>`;
}

/** Numbered lines, each keeping its newline so a selection copies them back. */
function numbered(lines) {
	return `<pre class="fv-src">${lines.map(l => `<span class="l">${escapeHtml(l)}\n</span>`).join('')}</pre>`;
}

/** A notebook as one labelled block per cell, up to the preview's line budget. */
function renderCells(nb) {
	let budget = PREVIEW_LINES;
	const shown = [];
	for (const c of nb.cells) {
		if (budget <= 0) { break; }
		const lines = c.lines.slice(0, budget);
		budget -= lines.length;
		shown.push(`<div class="fv-cell fv-${c.kind}"><div class="fv-ct">${escapeHtml(c.label)}</div>${numbered(lines)}</div>`);
	}
	const more = nb.cells.length > shown.length || budget < 0
		? `<p class="fv-note">Showing the first ${shown.length} of ${nb.cells.length} cells. Download for the full notebook.</p>`
		: '';
	return `<div class="fv-cells">${shown.join('')}</div>${more}`;
}

/** One viewer per saved file, hidden until its name is clicked. */
export function renderFileViewers(files) {
	return files.filter(f => f.kind !== 'missing').map(f => {
		const copy = f.kind === 'text' && f.text !== null
			? `<button type="button" class="fv-b f-copy" data-src="src-${f.id}">${ICON.copy}<span>Copy</span></button>`
			: '';
		const embedded = f.kind === 'text' && f.text !== null;
		const download = `<a class="fv-b f-dl" href="${escapeHtml(f.path)}" download="${escapeHtml(f.name)}"${embedded ? ` data-src="src-${f.id}"` : ''}>${ICON.download}<span>Download</span></a>`;
		let body;
		if (f.notebook) {
			body = renderCells(f.notebook);
		} else if (f.kind === 'text') {
			// Each line keeps its newline, so selecting and copying from the panel
			// gives the file's lines back.
			body = numbered(f.preview);
			if (f.lineCount > f.preview.length) {
				body += `<p class="fv-note">Showing the first ${f.preview.length} of ${f.lineCount} lines. Download for the full file.</p>`;
			}
		} else {
			body = '<p class="fv-note">Binary file: not shown. Download to open it.</p>';
		}
		return `<div class="lb fv" id="${f.id}" role="dialog" aria-modal="true" aria-label="${escapeHtml(f.name)}" hidden>
<button type="button" class="lb-backdrop" tabindex="-1" aria-label="Close"></button>
<div class="fv-panel">
<div class="fv-h"><span class="fv-n" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><span class="fv-m">${escapeHtml(metaText(f))}</span>`
			+ `<span class="fv-acts">${copy}${download}<button type="button" class="lb-close" aria-label="Close">${ICON.close}</button></span></div>
${body}
</div>
</div>${embedded ? `\n${sourceBlock(f)}` : ''}`;
	}).join('\n');
}

/** Run details' Test files part: every file, by its chip, with what it is and who used it. */
export function renderTestFilesPart(files) {
	if (!files.length) {
		return null;
	}
	const sep = ' <span class="log-sep" aria-hidden="true">&middot;</span> ';
	const rows = files.map(f => `<li>${fileChip(f)}`
		+ [escapeHtml(metaText(f)), f.descHtml, f.usesHtml].filter(Boolean).map(t => `${sep}<span class="log-note">${t}</span>`).join('')
		+ '</li>');
	return {
		title: 'Test files',
		html: '<p>Every file the scenarios used, saved as it was when used. Also in <code>files/</code> next to this report.</p>'
			+ `<ul class="log-list">${rows.join('')}</ul>`,
	};
}

/**
 * The agent prompt's Files section: where each file the finding names is, and
 * its text when it is short enough to read inline.
 */
export function promptFilesSection(files, markdown, where, fence) {
	return filesNamedIn(files, markdown).filter(f => f.kind !== 'missing').map(f => {
		const at = `${f.name}: ${where(f.path)}`;
		if (f.notebook) {
			const script = notebookScript(f.notebook);
			return script.split('\n').length <= PREVIEW_LINES
				? `${at} (its cells in percent format; the file is the notebook)\n${fence(script, FENCE[f.notebook.lang] ?? f.notebook.lang)}`
				: `${at} (${f.notebook.cells.length} cells; open the file)`;
		}
		if (f.kind === 'text' && f.text !== null && f.lineCount <= PREVIEW_LINES) {
			return `${at}\n${fence(f.text.replace(/\n$/, ''), FENCE[f.ext] ?? f.ext)}`;
		}
		return `${at} (${f.kind === 'binary' ? `binary, ${sizeText(f.size)}` : `${f.lineCount} lines`}; open the file)`;
	}).join('\n\n');
}

/** Copy, Download, and the viewer's open and close. */
export const FILE_SCRIPT = `(function(){
function text(id){var el=document.getElementById(id);if(!el){return null;}
if(el.dataset.enc!=='base64'){return el.textContent;}
var bin=atob(el.textContent.trim()),bytes=new Uint8Array(bin.length);
for(var i=0;i<bin.length;i++){bytes[i]=bin.charCodeAt(i);}
return new TextDecoder('utf-8').decode(bytes);}
function flash(b,word){var label=b.querySelector('span'),was=label.textContent;
b.classList.add('is-done');label.textContent=word;clearTimeout(b._t);
b._t=setTimeout(function(){b.classList.remove('is-done');label.textContent=was;},2000);}
document.querySelectorAll('.f-copy').forEach(function(b){b.addEventListener('click',function(){
var t=text(b.dataset.src);if(t===null){return;}
function done(){flash(b,'Copied');}
function fallback(){var ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','');
ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
var ok=false;try{ok=document.execCommand('copy');}catch(e){}ta.remove();if(ok){done();}}
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(done,fallback);}else{fallback();}});});
// Download builds the file from the embedded text, so it works when only the page was saved.
document.querySelectorAll('.f-dl[data-src]').forEach(function(a){a.addEventListener('click',function(e){
var t=text(a.dataset.src);if(t===null){return;}e.preventDefault();
var url=URL.createObjectURL(new Blob([t],{type:'text/plain;charset=utf-8'}));
var d=document.createElement('a');d.href=url;d.download=a.getAttribute('download');document.body.appendChild(d);d.click();d.remove();
setTimeout(function(){URL.revokeObjectURL(url);},1000);flash(a,'Downloaded');});});
var open=null,opener=null;
function show(v,from){if(open){hide();}open=v;opener=from||null;v.hidden=false;v.querySelector('.lb-close').focus();}
// Closing returns focus to the name that opened it, so the reader is where they were.
function hide(){if(!open){return;}open.hidden=true;open=null;if(opener){opener.focus();opener=null;}}
document.querySelectorAll('a.fn[data-file],a.fn-view[data-file]').forEach(function(a){a.addEventListener('click',function(e){
// A modified click does what the reader asked: the raw file in a new tab.
if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0){return;}
var v=document.getElementById(a.dataset.file);if(!v){return;}e.preventDefault();show(v,a);});});
document.querySelectorAll('.fv').forEach(function(v){
v.querySelector('.lb-close').addEventListener('click',hide);v.querySelector('.lb-backdrop').addEventListener('click',hide);});
document.addEventListener('keydown',function(e){if(!open){return;}
if(e.key==='Escape'){e.preventDefault();hide();}
else if(e.key==='Tab'){var stops=Array.prototype.slice.call(open.querySelectorAll('.fv-acts button,.fv-acts a'));
var i=stops.indexOf(document.activeElement);e.preventDefault();
stops[(i+(e.shiftKey?-1:1)+stops.length)%stops.length].focus();}});
// A link to #file-<id> opens that file, on load or from a link on the page.
function fromHash(){var id=location.hash.slice(1),v=id&&document.getElementById(id);
if(v&&v.classList.contains('fv')){show(v,document.activeElement);}}
window.addEventListener('hashchange',fromHash);fromHash();
})();`;
