/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Prints the page script for one step of debug.sh. Kept apart from the shell
// script so the JavaScript needs no shell quoting.
//
//   node debug-page.ts state
//   node debug-page.ts mark-button <label>
//   node debug-page.ts mark-frame <n>
//   node debug-page.ts mark-filter <name>
//   node debug-page.ts mark-header-action <view> <label>
//   node debug-page.ts console
//
// `mark-*` tags the element to click with data-dp-target (and the element to
// hover first with data-dp-hover), so debug.sh can use a real mouse click: the
// debug toolbar redraws after every step, so a snapshot ref taken before one
// step clicks nothing after it, and pane header actions have no size until
// the header is hovered.

const [step, a1, a2]: string[] = process.argv.slice(2);

const common = `
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	const unmark = () => document.querySelectorAll('[data-dp-target],[data-dp-hover]').forEach(e => { e.removeAttribute('data-dp-target'); e.removeAttribute('data-dp-hover'); });
	const shown = el => el && el.offsetParent !== null;
	// A list row's text with its pieces spaced ("dbg.R 7", "x = 3"); textContent runs them together.
	// Each element's own text nodes stay together, so a label split around a highlight keeps its letters.
	const rowText = r => [...r.querySelectorAll('*')].filter(e => !e.closest('.monaco-action-bar'))
		.map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()).filter(Boolean).join(' ').replace(/\\s+/g, ' ');
	const pane = title => [...document.querySelectorAll('.pane')].filter(shown)
		.find(p => clean(p.querySelector('.pane-header .title')).toLowerCase() === title.toLowerCase());
	// A line decoration's line number, from the line number drawn at the same height.
	const lineAt = (ed, el) => {
		const top = el.getBoundingClientRect().top;
		const nums = [...ed.querySelectorAll('.margin-view-overlays .line-numbers')];
		const hit = nums.find(n => Math.abs(n.getBoundingClientRect().top - top) < 3);
		return hit ? Number(clean(hit)) : null;
	};
	const toolbar = () => {
		const tb = [...document.querySelectorAll('.debug-toolbar')].find(shown);
		return tb ? [...tb.querySelectorAll('.action-label[aria-label]')].map(b => ({ el: b,
			label: b.getAttribute('aria-label').replace(/\\s*\\(.*\\)\\s*$/, ''),
			enabled: !(b.classList.contains('disabled') || b.getAttribute('aria-disabled') === 'true') })) : [];
	};
	const frames = () => [...document.querySelectorAll('.debug-call-stack .monaco-list-row')].filter(shown).map(r => ({ el: r,
		name: clean(r.querySelector('.stack-frame .label, .thread .name, .session .name')) || clean(r),
		file: clean(r.querySelector('.file-name')) || undefined,
		at: clean(r.querySelector('.line-number')) || undefined,
		focused: r.classList.contains('focused') || r.classList.contains('selected') }));
	const breakpointRows = () => [...document.querySelectorAll('.debug-breakpoints .monaco-list-row')].filter(shown).map(r => {
		const icon = r.querySelector('[class*="codicon-debug-breakpoint"], [class*="codicon-debug-hint"]');
		const kind = (icon?.className.match(/codicon-debug-([\\w-]+)/) || [])[1] || '';
		const box = r.querySelector('.monaco-checkbox, [role=checkbox]');
		return { el: r, box, text: rowText(r), path: (r.getAttribute('aria-label') || '').split(', ').find(x => x.includes('/')) || undefined,
			enabled: box ? (box.getAttribute('aria-checked') === 'true' || box.classList.contains('checked')) : undefined,
			icon: kind || undefined, exception: !icon };
	});
`;

const steps: Record<string, string> = {
	// What a person sees while debugging: paused or not and why, the toolbar,
	// the call stack, the line marked in each editor, variables, watches and
	// breakpoints.
	state: `(() => {${common}
		const csPane = pane('Call Stack');
		const reason = clean(csPane?.querySelector('.pane-header .monaco-count-badge, .pane-header .state-message, .pane-header .description'))
			|| clean(csPane?.querySelector('.pane-header')).replace(/^call stack\\s*/i, '') || undefined;
		const editors = [...document.querySelectorAll('.editor-group-container')].filter(shown).flatMap(g => {
			const tab = clean(g.querySelector('.tab.active .label-name'));
			return [...g.querySelectorAll('.monaco-editor')].filter(shown).slice(0, 1).map(ed => {
				const marks = [...ed.querySelectorAll('.debug-top-stack-frame-line, .debug-focused-stack-frame-line')]
					.map(d => ({ line: lineAt(ed, d), kind: d.classList.contains('debug-top-stack-frame-line') ? 'top frame' : 'focused frame' }));
				const glyphs = [...ed.querySelectorAll('.margin-view-overlays [class*="codicon-debug-"], .glyph-margin-widgets [class*="codicon-debug-"]')]
					.map(g => ({ line: lineAt(ed, g), icons: (g.className.match(/codicon-debug-[\\w-]+/g) || []).map(c => c.replace('codicon-debug-', '')) }));
				return { tab, active: g.classList.contains('active'), frameLines: marks, glyphs };
			});
		});
		const rowsOf = sel => [...document.querySelectorAll(sel + ' .monaco-list-row')].filter(shown)
			.map(r => ({ level: Number(r.getAttribute('aria-level') || 1) - 1, expanded: r.getAttribute('aria-expanded') === null ? undefined : r.getAttribute('aria-expanded') === 'true', text: clean(r) }));
		return JSON.stringify({ ok: true,
			debugging: toolbar().length > 0,
			reason,
			toolbar: toolbar().map(({ label, enabled }) => enabled ? label : label + ' (disabled)'),
			callStack: frames().map(({ el, ...f }) => f),
			editors,
			variables: rowsOf('.debug-variables'),
			watch: rowsOf('.debug-watch'),
			breakpoints: breakpointRows().map(({ el, box, ...b }) => b),
		});
	})()`,

	'mark-button': `(() => {${common}
		unmark();
		const want = ${JSON.stringify((a1 ?? '').toLowerCase())};
		const all = toolbar();
		if (!all.length) { return JSON.stringify({ ok: false, error: 'no debug toolbar: nothing is being debugged' }); }
		const b = all.find(x => x.label.toLowerCase() === want) || all.find(x => x.label.toLowerCase().startsWith(want));
		if (!b) { return JSON.stringify({ ok: false, error: 'no toolbar button ' + want, buttons: all.map(x => x.label) }); }
		if (!b.enabled) { return JSON.stringify({ ok: false, error: b.label + ' is disabled' }); }
		b.el.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, button: b.label });
	})()`,

	'mark-frame': `(() => {${common}
		unmark();
		const all = frames();
		const f = all[Number(${JSON.stringify(a1 ?? '0')}) - 1];
		if (!f) { return JSON.stringify({ ok: false, error: 'no frame ' + ${JSON.stringify(a1 ?? '')}, callStack: all.map(({ el, ...x }) => x) }); }
		f.el.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, frame: (({ el, ...x }) => x)(f) });
	})()`,

	// An exception breakpoint row (Errors, Warnings, Interrupts) or a line
	// breakpoint row, by its text; marks its checkbox.
	'mark-filter': `(() => {${common}
		unmark();
		const want = ${JSON.stringify((a1 ?? '').toLowerCase())};
		const all = breakpointRows();
		const hits = all.filter(b => b.text.toLowerCase() === want);
		const pool = hits.length ? hits : all.filter(b => b.text.toLowerCase().includes(want));
		if (pool.length !== 1 || !pool[0].box) { return JSON.stringify({ ok: false, error: pool.length > 1 ? pool.length + ' breakpoint rows match' : 'no breakpoint row ' + want + '; is the Breakpoints view open?', rows: all.map(b => b.text) }); }
		pool[0].box.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, row: pool[0].text, enabled: pool[0].enabled });
	})()`,

	'mark-header-action': `(() => {${common}
		unmark();
		const p = pane(${JSON.stringify(a1 ?? '')});
		if (!p) { return JSON.stringify({ ok: false, error: 'no ' + ${JSON.stringify(a1 ?? '')} + ' view on screen' }); }
		const a = [...p.querySelectorAll('.pane-header .action-label')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(a2 ?? '')});
		if (!a) { return JSON.stringify({ ok: false, error: 'no ' + ${JSON.stringify(a2 ?? '')} + ' action on that view' }); }
		p.querySelector('.pane-header').setAttribute('data-dp-hover', '1');
		a.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true });
	})()`,

	focused: `(() => JSON.stringify({ ok: true, inWatch: !!document.activeElement?.closest('.debug-watch'), inRepl: !!document.activeElement?.closest('.repl') }))()`,

	console: `(() => {${common}
		const r = [...document.querySelectorAll('.repl')].find(shown);
		if (!r) { return JSON.stringify({ ok: false, error: 'the Debug Console is not on screen' }); }
		return JSON.stringify({ ok: true, lines: [...r.querySelectorAll('.monaco-list-row')].map(x => x.innerText.replace(/\\u00A0/g, ' ')) });
	})()`,

	'mark-repl-input': `(() => {${common}
		unmark();
		const i = [...document.querySelectorAll('.repl .repl-input-wrapper')].find(shown);
		if (!i) { return JSON.stringify({ ok: false, error: 'the Debug Console is not on screen' }); }
		i.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true });
	})()`,

	unmark: `(() => {${common} unmark(); return '{}'; })()`,
};

if (!steps[step]) {
	console.error('debug-page.ts: unknown step ' + step);
	process.exit(2);
}
process.stdout.write(steps[step]);
