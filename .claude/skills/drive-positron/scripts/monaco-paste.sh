#!/usr/bin/env bash
# Inserts text into Positron's Monaco chat input through the attached
# @playwright/cli CDP session. It dispatches a ClipboardEvent with a DataTransfer
# payload, avoiding the system clipboard and supporting parallel instances.
#
# Monaco's native-edit-context does not respond reliably to Playwright's fill or
# type operations. Using pbcopy would work for one instance but introduces a
# process-wide clipboard race.
#
# Usage:
#   echo "the prompt text" | scripts/monaco-paste.sh
#   scripts/monaco-paste.sh "the prompt text"
#   scripts/monaco-paste.sh --append "additional text"   # don't clear first
#   scripts/monaco-paste.sh --no-verify "..."            # skip read-back check
#   scripts/monaco-paste.sh --session NAME "..."         # use a named @playwright/cli session
#                                                        # (also honored via $PW_SESSION env var;
#                                                        #  required for parallel multi-instance runs
#                                                        #  — see SKILL.md "Typing into Monaco")
#
# Stdout: a single JSON line, e.g.
#   {"ok":true,"actualLength":47,"expectedLength":47,"viewLineCount":1,"firstViewLine":"..."}
# Stderr: diagnostic noise from @playwright/cli (suppressed unless caller wants it).
# Exit code:
#   0  success
#   1  paste verify failed, eval failed, or the page had no native-edit-context
#   2  argument/usage error (empty input, missing tools)
#
# Required tools on PATH: npx (with @playwright/cli reachable), node, jq.
#
# Assumes:
#   - You have already run `npx @playwright/cli [-s=NAME] attach --cdp=http://127.0.0.1:$CDP`
#     in the same session this script reads (--session arg, $PW_SESSION env, or "default").
#   - The Agents window is open and a new-chat / chat view with a Monaco
#     editor is on screen. The script auto-focuses the first
#     `.new-chat-input-area .native-edit-context`, falling back to any
#     `.native-edit-context`.

set -u
umask 077

APPEND=0
VERIFY=1
TEXT_ARG=""
PW_SESSION_OVERRIDE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--append) APPEND=1; shift ;;
		--no-verify) VERIFY=0; shift ;;
		--session) PW_SESSION_OVERRIDE="$2"; shift 2 ;;
		--session=*) PW_SESSION_OVERRIDE="${1#--session=}"; shift ;;
		-h|--help)
			sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		--) shift; TEXT_ARG="${*-}"; break ;;
		-*) echo "monaco-paste.sh: unknown flag $1" >&2; exit 2 ;;
		*) TEXT_ARG="$1"; shift ;;
	esac
done

# Session precedence: --session, then $PW_SESSION, then the CLI default.
SESSION="${PW_SESSION_OVERRIDE:-${PW_SESSION:-}}"
PW_ARGS=()
[[ -n "$SESSION" ]] && PW_ARGS=("-s=$SESSION")

# Prefer a positional argument; otherwise read stdin, which avoids shell-quoting
# problems for arbitrary multiline text.
if [[ -n "${TEXT_ARG:-}" ]]; then
	TEXT="$TEXT_ARG"
else
	TEXT=$(cat)
fi

if [[ -z "$TEXT" ]]; then
	echo '{"ok":false,"error":"empty input"}' >&2
	exit 2
fi

# Sanity: required tools on PATH.
for tool in npx node jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		printf '{"ok":false,"error":"%s not on PATH"}\n' "$tool"
		echo "monaco-paste.sh: required tool '$tool' not on PATH" >&2
		exit 2
	fi
done

# Select-all uses Command on macOS and Control elsewhere.
case "${OSTYPE:-$(uname -s)}" in
	darwin*|Darwin*) SELECT_ALL_MOD="Meta" ;;
	*)               SELECT_ALL_MOD="Control" ;;
esac

# Clear the editor through Monaco's keyboard handling without using a clipboard.
if [[ "$APPEND" != "1" ]]; then
	npx @playwright/cli ${PW_ARGS[@]+"${PW_ARGS[@]}"} press "${SELECT_ALL_MOD}+a" >/dev/null 2>&1 || true
	npx @playwright/cli ${PW_ARGS[@]+"${PW_ARGS[@]}"} press Backspace >/dev/null 2>&1 || true
fi

# Build the evaluation payload in Node for automatic JSON escaping. Wait for two
# animation frames because Monaco updates its rendered lines asynchronously.
JS=$(node -e '
	const text = process.argv[1];
	const verify = process.argv[2] === "1";
	console.log(`(async () => {
		const root = document.querySelector(".new-chat-input-area .native-edit-context")
				  || document.querySelector(".sessions-chat-editor .native-edit-context")
				  || document.querySelector(".native-edit-context");
		if (!root) return JSON.stringify({ ok: false, error: "no native-edit-context found on page" });
		root.focus();
		const dt = new DataTransfer();
		dt.setData("text/plain", ${JSON.stringify(text)});
		root.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		const editor = root.closest(".monaco-editor");
		const viewLines = Array.from(editor.querySelectorAll(".view-line")).map(l => l.textContent);
		// Monaco renders ASCII spaces as non-breaking spaces, and joining rendered lines
		// removes logical newlines. Normalize both representations before comparing.
		// The escapes are doubled because this code is embedded in a template literal.
		const norm = s => s.replace(/\\u00A0/g, " ").replace(/\\r?\\n/g, "");
		const joined = norm(viewLines.join(""));
		const actualLength = joined.length;
		const expectedFull = norm(${JSON.stringify(text)});
		const expectedPrefix = expectedFull.slice(0, Math.min(40, expectedFull.length));
		const prefixMatched = joined.startsWith(expectedPrefix) || joined.includes(expectedPrefix.slice(0, 20));
		const verifyEnabled = ${verify ? "true" : "false"};
		return JSON.stringify({
			ok: !verifyEnabled || prefixMatched,
			actualLength,
			expectedLength: ${JSON.stringify(text)}.length,
			viewLineCount: viewLines.length,
			firstViewLine: (viewLines[0] || "").slice(0, 80),
			error: (!verifyEnabled || prefixMatched) ? undefined : "paste read-back did not match expected prefix"
		});
	})()`);
' "$TEXT" "$VERIFY")

# Extract the JSON-encoded result from the CLI's diagnostic output.
RAW=$(npx @playwright/cli ${PW_ARGS[@]+"${PW_ARGS[@]}"} eval "$JS" 2>&1) || {
	echo "{\"ok\":false,\"error\":\"@playwright/cli eval failed\"}"
	echo "$RAW" >&2
	exit 1
}

RESULT_LINE=$(echo "$RAW" | grep -A 1 '### Result' | tail -n1)
if [[ -z "$RESULT_LINE" ]]; then
	echo '{"ok":false,"error":"no ### Result section in eval output"}'
	echo "$RAW" >&2
	exit 1
fi

# RESULT_LINE is a JSON-encoded string containing our inner JSON.
# Unwrap once with jq.
CLEAN=$(echo "$RESULT_LINE" | jq -r 'fromjson' 2>/dev/null) || {
	echo "{\"ok\":false,\"error\":\"failed to parse result line\",\"raw\":$(echo "$RESULT_LINE" | jq -Rs .)}"
	exit 1
}

echo "$CLEAN"
OK=$(echo "$CLEAN" | jq -r '.ok')
[[ "$OK" == "true" ]]
