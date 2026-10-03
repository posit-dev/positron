/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Prints the page script for one step of console-run.sh. Kept apart from the
// shell script so the JavaScript needs no shell quoting.
//
//   node console-run-page.ts <select|paste|count> <python|r> <name> <code>

const [step, language, name, text]: string[] = process.argv.slice(2);

// What every step needs: the active console, a session's id from its test id,
// and a way to count the code's first line in a console's text.
const common = `
	const lang = ${JSON.stringify(language)};
	const active = () => document.querySelector('.console-instance[style*="z-index: auto"]');
	const idOf = el => (el?.getAttribute('data-testid') || '').replace(/^console-(tab-)?/, '');
	const norm = s => s.replace(/\\u00A0/g, ' ');
	const firstLine = norm(${JSON.stringify(text)}).split(/\\r?\\n/).map(l => l.trim()).find(Boolean) || '';
	const probe = firstLine.slice(0, 40);
	const count = (hay, needle) => needle ? norm(hay).split(needle).length - 1 : 0;
`;

const steps: Record<string, string> = {
	// Make the language session's console the active one, and focus its input.
	select: `(async () => {${common}
		const want = ${JSON.stringify(name)};
		const tabs = [...document.querySelectorAll('[data-testid^="console-tab-' + lang + '-"]')]
			.filter(t => !want || (t.getAttribute('aria-label') || '').includes(want));
		let target;
		if (tabs.length > 1) {
			return JSON.stringify({ ok: false, error: 'several ' + lang + ' sessions; pass --name with part of one: ' + tabs.map(t => t.getAttribute('aria-label')).join(', ') });
		} else if (tabs.length === 1) {
			target = idOf(tabs[0]);
		} else if (!document.querySelector('[data-testid^="console-tab-"]') && idOf(active()).startsWith(lang + '-')) {
			// One session, so there are no tabs: the active console is the only one.
			target = idOf(active());
		} else {
			return JSON.stringify({ ok: false, error: 'no ' + lang + ' session' + (want ? ' named like "' + want + '"' : '') + '; start one first' });
		}
		const switched = idOf(active()) !== target;
		if (switched) {
			document.querySelector('[data-testid="console-tab-' + target + '"]').click();
			for (let i = 0; i < 30 && idOf(active()) !== target; i++) { await new Promise(r => setTimeout(r, 100)); }
			if (idOf(active()) !== target) {
				return JSON.stringify({ ok: false, error: 'the ' + target + ' console did not become active' });
			}
		}
		const instance = active();
		const input = instance.querySelector('.console-input .native-edit-context');
		if (!input) { return JSON.stringify({ ok: false, error: 'no console input in ' + target }); }
		input.focus();
		const tab = document.querySelector('[data-testid="console-tab-' + target + '"]');
		return JSON.stringify({
			ok: true, sessionId: target, switched,
			session: tab?.getAttribute('aria-label') || null,
			busy: !!document.querySelector('.codicon-positron-interrupt-runtime'),
			before: count(instance.innerText, probe),
		});
	})()`,

	// Paste into the focused input and read it back.
	paste: `(async () => {${common}
		const input = active()?.querySelector('.console-input .native-edit-context');
		if (!input) { return JSON.stringify({ ok: false, error: 'no console input' }); }
		input.focus();
		const dt = new DataTransfer();
		dt.setData('text/plain', ${JSON.stringify(text)});
		input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		const shown = norm([...input.closest('.monaco-editor').querySelectorAll('.view-line')].map(l => l.textContent).join('\\n'));
		const ok = shown.includes(probe.slice(0, 20));
		return JSON.stringify({ ok, error: ok ? undefined : 'the pasted code is not in the console input' });
	})()`,

	// Count the code's first line in the active console again, to see that it was echoed.
	count: `(() => {${common}
		return JSON.stringify({ id: idOf(active()), n: count(active()?.innerText || '', probe) });
	})()`,
};

if (!steps[step]) {
	console.error('console-run-page.ts: unknown step ' + step);
	process.exit(2);
}
console.log(steps[step]);
