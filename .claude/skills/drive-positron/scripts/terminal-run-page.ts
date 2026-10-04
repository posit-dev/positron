/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Prints the page script for one step of terminal-run.sh. Kept apart from the
// shell script so the JavaScript needs no shell quoting.
//
//   node terminal-run-page.ts <paste|check> <index> <command>

const [step, index, text]: string[] = process.argv.slice(2);

// What every step needs: the terminal the command is for. Terminals in the
// panel and in the editor area are both xterm elements; only visible ones count,
// numbered left to right, then top to bottom. A terminal's sticky-scroll
// overlay is an xterm of its own, so it is left out.
const common = `
	const want = ${JSON.stringify(index)};
	const visible = [...document.querySelectorAll('.xterm')]
		.filter(e => !e.closest('.terminal-sticky-scroll'))
		.filter(e => e.offsetParent && e.getBoundingClientRect().width > 0)
		.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left || a.getBoundingClientRect().top - b.getBoundingClientRect().top);
	const pick = () => {
		if (visible.length === 0) { return { error: 'no terminal is visible; open one first' }; }
		if (want === '' && visible.length > 1) { return { error: visible.length + ' terminals are visible; pass --index 1 to ' + visible.length + ', numbered left to right' }; }
		const n = want === '' ? 1 : Number(want);
		if (!(n >= 1 && n <= visible.length)) { return { error: '--index ' + want + ' is out of range: ' + visible.length + ' visible' }; }
		const input = visible[n - 1].querySelector('.xterm-helper-textarea');
		return input ? { input, n } : { error: 'terminal ' + n + ' has no input' };
	};
`;

const steps: Record<string, string> = {
	// Focus the terminal, so the Enter that follows goes to it, then paste into
	// its input. Nothing is pasted unless focus took, so a failure leaves no
	// half-typed command behind.
	paste: `(async () => {${common}
		const { input, n, error } = pick();
		if (error) { return JSON.stringify({ ok: false, error }); }
		input.focus();
		await new Promise(r => requestAnimationFrame(r));
		if (document.activeElement !== input) { return JSON.stringify({ ok: false, error: 'the terminal did not take focus' }); }
		const dt = new DataTransfer();
		dt.setData('text/plain', ${JSON.stringify(text)});
		input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		return JSON.stringify({ ok: true, index: n, visible: visible.length });
	})()`,

	// After Enter: focus still in that terminal means the key went there.
	check: `(() => {${common}
		const { input, error } = pick();
		if (error) { return JSON.stringify({ ok: false, error }); }
		const ok = document.activeElement === input;
		return JSON.stringify({ ok, error: ok ? undefined : 'focus left the terminal; Enter may have gone elsewhere' });
	})()`,
};

if (!steps[step]) {
	console.error('terminal-run-page.ts: unknown step ' + step);
	process.exit(2);
}
console.log(steps[step]);
