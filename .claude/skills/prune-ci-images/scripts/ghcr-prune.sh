#!/usr/bin/env bash
# Delete the GHCR container versions listed in a reviewed audit file.
# Defaults to a dry run; requires --confirm to actually delete.
#
# Every safety check in this script FAILS CLOSED: if any version or manifest
# cannot be read, the run aborts rather than assuming the deletion is safe.
set -euo pipefail

ORG="posit-dev"
LIST=""
CONFIRM=0
ALLOW_SPLIT=0
REPO_PATH=""
PROTECT_TAGS=""

usage() {
	cat <<'EOF'
Usage: ghcr-prune.sh --list FILE [options]

  --list FILE      Reviewed review-list markdown produced by ghcr-audit.sh
  --org ORG        GitHub org that owns the packages (default: posit-dev)
  --repo-path PATH Checkout to re-scan for in-use tags. Pass the SAME path
                   used for the audit; without it the in-use recheck is
                   skipped and the script warns.
  --protect-tag T  Extra tag to treat as in-use (repeatable)
  --confirm        Actually delete. Without this it is a dry run.
  --allow-split-group
                   Proceed even if a multi-arch group is only partially
                   listed. Dangerous: can orphan a manifest index.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--list) LIST="$2"; shift 2 ;;
		--org) ORG="$2"; shift 2 ;;
		--repo-path) REPO_PATH="$2"; shift 2 ;;
		--protect-tag) PROTECT_TAGS="$PROTECT_TAGS $2"; shift 2 ;;
		--confirm) CONFIRM=1; shift ;;
		--allow-split-group) ALLOW_SPLIT=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "unknown option: $1" >&2; usage; exit 2 ;;
	esac
done

[ -n "$LIST" ] || { echo "--list is required" >&2; usage; exit 2; }
[ -f "$LIST" ] || { echo "no such file: $LIST" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated" >&2; exit 1; }

if ! gh auth status 2>&1 | grep -q 'delete:packages'; then
	echo "! The active gh token lacks the delete:packages scope." >&2
	echo "  Run: gh auth refresh -h github.com -s read:packages -s delete:packages" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Re-scan the repo for in-use "<pkg>:<tag>" references -----------------
: > "$WORK/inuse.txt"
if [ -n "$REPO_PATH" ]; then
	for d in .github docker test scripts build; do
		[ -d "$REPO_PATH/$d" ] || continue
		grep -rhoE "ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+" "$REPO_PATH/$d" 2>/dev/null \
			| sed -E 's#^ghcr\.io/[^/]+/##' >> "$WORK/inuse.txt" || true
	done
	sort -u -o "$WORK/inuse.txt" "$WORK/inuse.txt"
else
	echo "! --repo-path not given: skipping the in-use tag recheck." >&2
	echo "  A tag that became referenced since the audit will NOT be caught." >&2
fi
for t in $PROTECT_TAGS; do echo "*:$t" >> "$WORK/inuse.txt"; done

GH_USER="$(gh api user --jq .login)"
GH_TOKEN_VAL="$(gh auth token)"

# --- Validate the reviewed list against the CURRENT registry state --------
set +e
WORK="$WORK" ORG="$ORG" LIST="$LIST" ALLOW_SPLIT="$ALLOW_SPLIT" \
GH_USER="$GH_USER" GH_TOKEN_VAL="$GH_TOKEN_VAL" python3 <<'EOPY'
import base64, json, os, re, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

work = os.environ["WORK"]
org = os.environ["ORG"]
list_path = os.environ["LIST"]
allow_split = os.environ["ALLOW_SPLIT"] == "1"
gh_user, gh_token = os.environ["GH_USER"], os.environ["GH_TOKEN_VAL"]

def die(msg, detail=()):
	print(f"\n! {msg}", file=sys.stderr)
	for d in detail:
		print(f"    {d}", file=sys.stderr)
	sys.exit(1)

# --- Parse the reviewed table -----------------------------------------
# A deletion row has exactly 7 columns and a numeric id. The "Excluded"
# table has 4 columns and is therefore ignored.
rows = []
for line in open(list_path):
	line = line.rstrip("\n")
	if not line.startswith("|"):
		continue
	cells = [c.strip() for c in line.strip().strip("|").split("|")]
	if len(cells) != 7 or not cells[1].isdigit():
		continue
	tags = set() if "_untagged_" in cells[2] else set(re.findall(r"`([^`]+)`", cells[2]))
	rows.append({
		"pkg": cells[0].strip("`"),
		"id": cells[1],
		"tags": tags,
		"group": cells[6].strip("`"),
	})

if not rows:
	print(f"No deletion rows found in {list_path} -- nothing to do.", file=sys.stderr)
	open(f"{work}/todelete.tsv", "w").close()
	sys.exit(0)
print(f"==> {len(rows)} rows parsed from {list_path}")

pkgs = sorted({r["pkg"] for r in rows})

# --- Re-fetch current state of every involved package (fail closed) ----
def fetch_versions(pkg):
	enc = pkg.replace("/", "%2F")
	p = subprocess.run(
		["gh", "api", f"/orgs/{org}/packages/container/{enc}/versions?per_page=100",
		 "--paginate", "--jq",
		 '.[] | {id:.id, digest:.name, tags:(.metadata.container.tags // [])} | @json'],
		capture_output=True, text=True)
	if p.returncode != 0:
		return pkg, None, p.stderr.strip()
	out = {}
	for line in p.stdout.splitlines():
		if line.strip():
			v = json.loads(line)
			out[str(v["id"])] = {"digest": v["digest"], "tags": set(v["tags"])}
	return pkg, out, None

print(f"==> Re-reading {len(pkgs)} packages from the API")
current, errors = {}, []
with ThreadPoolExecutor(max_workers=8) as ex:
	for pkg, out, err in ex.map(fetch_versions, pkgs):
		if out is None:
			errors.append(f"{pkg}: {err}")
		else:
			current[pkg] = out
if errors:
	die("Could not re-read these packages, so the deletion cannot be validated:",
	    errors + ["", "Fix API access and re-run. Nothing was deleted."])

# --- Drift check: has anything changed since the audit? ---------------
gone, drift = [], []
for r in rows:
	cur = current[r["pkg"]].get(r["id"])
	if cur is None:
		gone.append(r)
		continue
	r["digest"] = cur["digest"]
	if cur["tags"] != r["tags"]:
		was = ", ".join(sorted(r["tags"])) or "untagged"
		now = ", ".join(sorted(cur["tags"])) or "untagged"
		drift.append(f"{r['pkg']} {r['id']}: audit recorded [{was}], registry now has [{now}]")
if drift:
	die("Tags changed since the audit ran (a digest may have been retagged "
	    "and put back into use):",
	    drift + ["", "Re-run ghcr-audit.sh to regenerate the list. Nothing was deleted."])

if gone:
	print(f"==> {len(gone)} listed versions no longer exist (already deleted); skipping them")
	ids_gone = {(r["pkg"], r["id"]) for r in gone}
	rows = [r for r in rows if (r["pkg"], r["id"]) not in ids_gone]
	if not rows:
		print("Nothing left to delete.", file=sys.stderr)
		open(f"{work}/todelete.tsv", "w").close()
		sys.exit(0)

# --- In-use recheck against the current tags --------------------------
inuse = set()
try:
	inuse = {l.strip() for l in open(f"{work}/inuse.txt") if l.strip()}
except FileNotFoundError:
	pass
inuse_any = {r.split(":", 1)[1] for r in inuse if r.startswith("*:")}

nowused = []
for r in rows:
	for t in sorted(r["tags"]):
		if f"{r['pkg']}:{t}" in inuse or t in inuse_any:
			nowused.append(f"{r['pkg']}:{t} (version {r['id']}) is referenced in the repo")
if nowused:
	die("Listed versions are referenced by the repo and must not be deleted:",
	    nowused + ["", "Remove these rows from the list, or re-run the audit. "
	               "Nothing was deleted."])

# --- Resolve every manifest in the involved packages (fail closed) -----
_tok, _tok_err = {}, {}
def bearer(pkg):
	if pkg in _tok:
		return _tok[pkg]
	req = urllib.request.Request(
		f"https://ghcr.io/token?service=ghcr.io&scope=repository:{org}/{pkg}:pull")
	basic = base64.b64encode(f"{gh_user}:{gh_token}".encode()).decode()
	req.add_header("Authorization", f"Basic {basic}")
	try:
		with urllib.request.urlopen(req, timeout=30) as r:
			_tok[pkg] = json.load(r)["token"]
	except Exception as e:
		_tok[pkg] = None
		_tok_err[pkg] = str(e)
	return _tok[pkg]

ACCEPT = ",".join([
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.v2+json",
])

def children(args):
	"""(pkg, digest) -> (key, child_digests, error). Never guesses on failure."""
	pkg, digest = args
	tok = bearer(pkg)
	if not tok:
		return (pkg, digest), None, f"no registry token for {pkg}: {_tok_err.get(pkg)}"
	req = urllib.request.Request(f"https://ghcr.io/v2/{org}/{pkg}/manifests/{digest}")
	req.add_header("Authorization", f"Bearer {tok}")
	req.add_header("Accept", ACCEPT)
	try:
		with urllib.request.urlopen(req, timeout=30) as r:
			m = json.load(r)
	except Exception as e:
		return (pkg, digest), None, f"{pkg} {digest[:19]}: {e}"
	return (pkg, digest), [x["digest"] for x in m.get("manifests", [])], None

targets = [(pkg, v["digest"]) for pkg in pkgs for v in current[pkg].values()]
print(f"==> Resolving {len(targets)} manifests in {len(pkgs)} packages")
kids, mf_errors = {}, []
with ThreadPoolExecutor(max_workers=8) as ex:
	for key, ch, err in ex.map(children, targets):
		if ch is None:
			mf_errors.append(err)
		else:
			kids[key] = ch
if mf_errors:
	die("Could not resolve these manifests, so multi-arch safety cannot be "
	    "verified:",
	    mf_errors[:20]
	    + ([f"... and {len(mf_errors) - 20} more"] if len(mf_errors) > 20 else [])
	    + ["", "Deleting a manifest child breaks the tagged image that points "
	       "at it. Fix registry access and re-run. Nothing was deleted."])

# --- Re-derive the protected set: children of everything NOT listed ----
listed = {(r["pkg"], r["digest"]) for r in rows}
protected = {}
for pkg in pkgs:
	for vid, v in current[pkg].items():
		if (pkg, v["digest"]) in listed:
			continue
		for c in kids.get((pkg, v["digest"]), []):
			tagdesc = ", ".join(sorted(v["tags"])) or v["digest"][:19]
			protected[(pkg, c)] = f"{pkg} version {vid} [{tagdesc}]"

violations = [
	f"{r['pkg']} {r['id']} ({r['digest'][:19]}) is a manifest child of {protected[(r['pkg'], r['digest'])]}"
	for r in rows if (r["pkg"], r["digest"]) in protected
]
if violations:
	die("Listed versions are still referenced by a retained multi-arch index:",
	    violations + ["", "Deleting them would break that image. Remove these "
	                  "rows, or re-run the audit. Nothing was deleted."])

# --- Group integrity: a listed index needs all its children listed -----
split = [
	f"{r['pkg']} index {r['digest'][:19]} is listed but its child {c[:19]} is not"
	for r in rows for c in kids.get((r["pkg"], r["digest"]), [])
	if (r["pkg"], c) not in listed
]
if split:
	if not allow_split:
		die("Split multi-arch group detected:",
		    split + ["", "Deleting an index without its children (or vice versa) "
		             "can leave a broken image. Add the missing rows back, remove "
		             "the whole group, or re-run with --allow-split-group. "
		             "Nothing was deleted."])
	print("\n! Split multi-arch group detected:", file=sys.stderr)
	for s in split:
		print(f"    {s}", file=sys.stderr)
	print("  --allow-split-group given; continuing anyway.", file=sys.stderr)

with open(f"{work}/todelete.tsv", "w") as fh:
	for r in rows:
		fh.write(f"{r['pkg']}\t{r['id']}\n")

print("==> All safety checks passed")
EOPY
RC=$?
set -e
[ "$RC" = "0" ] || exit "$RC"
[ -s "$WORK/todelete.tsv" ] || exit 0

ROWS=$(wc -l < "$WORK/todelete.tsv" | tr -d ' ')

echo ""
echo "Versions to delete, by package:"
cut -f1 "$WORK/todelete.tsv" | sort | uniq -c | sort -rn | sed 's/^/  /'
echo ""

if [ "$CONFIRM" = "0" ]; then
	echo "DRY RUN -- nothing deleted. Re-run with --confirm to delete these $ROWS versions."
	exit 0
fi

# --- Delete ---------------------------------------------------------------
OK=0; FAIL=0
: > "$WORK/failed.tsv"
while IFS=$'\t' read -r pkg id; do
	[ -n "$id" ] || continue
	enc="${pkg//\//%2F}"
	if gh api -X DELETE "/orgs/$ORG/packages/container/$enc/versions/$id" >/dev/null 2>"$WORK/err"; then
		OK=$((OK+1))
		printf '  deleted %s %s\n' "$pkg" "$id"
	else
		FAIL=$((FAIL+1))
		printf '%s\t%s\t%s\n' "$pkg" "$id" "$(tr -d '\n' < "$WORK/err")" >> "$WORK/failed.tsv"
		printf '  FAILED  %s %s -- %s\n' "$pkg" "$id" "$(head -c 200 "$WORK/err")" >&2
	fi
done < "$WORK/todelete.tsv"

echo ""
echo "==> Deleted $OK, failed $FAIL of $ROWS"
echo "A deleted version can usually be restored within 30 days:"
echo "  gh api -X POST /orgs/$ORG/packages/container/<pkg>/versions/<id>/restore"
if [ "$FAIL" -gt 0 ]; then
	echo "Failures:" >&2
	cat "$WORK/failed.tsv" >&2
	exit 1
fi
