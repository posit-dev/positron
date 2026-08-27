#!/usr/bin/env bash
# Delete the GHCR container versions listed in a reviewed audit file.
# Defaults to a dry run; requires --confirm to actually delete.
set -euo pipefail

ORG="posit-dev"
LIST=""
CONFIRM=0
ALLOW_SPLIT=0

usage() {
	cat <<'EOF'
Usage: ghcr-prune.sh --list FILE [options]

  --list FILE     Reviewed review-list markdown produced by ghcr-audit.sh
  --org ORG       GitHub org that owns the packages (default: posit-dev)
  --confirm       Actually delete. Without this it is a dry run.
  --allow-split-group
                  Proceed even if a multi-arch group is only partially listed.
                  Dangerous: can orphan a manifest index. Default is to abort.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--list) LIST="$2"; shift 2 ;;
		--org) ORG="$2"; shift 2 ;;
		--confirm) CONFIRM=1; shift ;;
		--allow-split-group) ALLOW_SPLIT=1; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "unknown option: $1" >&2; usage; exit 2 ;;
	esac
done

[ -n "$LIST" ] || { echo "--list is required" >&2; usage; exit 2; }
[ -f "$LIST" ] || { echo "no such file: $LIST" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated" >&2; exit 1; }

if ! gh auth status 2>&1 | grep -q 'delete:packages'; then
	echo "! The active gh token lacks the delete:packages scope." >&2
	echo "  Run: gh auth refresh -h github.com -s delete:packages" >&2
	exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Parse the reviewed table --------------------------------------------
# Rows look like: | `pkg` | 12345 | `tag` | 120 | 2026-01-01 | untagged | `sha256:...` |
awk -F'|' '
	/^\|/ {
		pkg = $2; id = $3; grp = $8
		gsub(/[ `]/, "", pkg); gsub(/[ `]/, "", id); gsub(/[ `]/, "", grp)
		if (id ~ /^[0-9]+$/) { print pkg "\t" id "\t" grp }
	}
' "$LIST" > "$WORK/rows.tsv"

ROWS=$(wc -l < "$WORK/rows.tsv" | tr -d ' ')
if [ "$ROWS" = "0" ]; then
	echo "No deletion rows found in $LIST -- nothing to do." >&2
	exit 0
fi
echo "==> $ROWS rows parsed from $LIST"

# --- Group integrity check ------------------------------------------------
# Re-derive each listed group's full membership from the ORIGINAL audit table
# is not possible here, so instead verify internal consistency: every group
# present must have all of its rows still listed. We detect a split group by
# comparing against the audit file's own record of group sizes, recomputed
# from the untouched "Deletion candidates" section is gone once edited -- so
# we verify against the registry instead: for each listed index, all of its
# children must also be listed.
GH_USER="$(gh api user --jq .login)"
GH_TOKEN_VAL="$(gh auth token)"

SPLIT=$(WORK="$WORK" ORG="$ORG" GH_USER="$GH_USER" GH_TOKEN_VAL="$GH_TOKEN_VAL" python3 <<'EOPY'
import base64, json, os, urllib.request

work, org = os.environ["WORK"], os.environ["ORG"]
gh_user, gh_token = os.environ["GH_USER"], os.environ["GH_TOKEN_VAL"]

rows = []
with open(f"{work}/rows.tsv") as fh:
	for line in fh:
		p = line.rstrip("\n").split("\t")
		if len(p) == 3:
			rows.append({"pkg": p[0], "id": p[1], "group": p[2]})

# Map version id -> digest so we can resolve manifests.
digests = {}
for pkg in {r["pkg"] for r in rows}:
	enc = pkg.replace("/", "%2F")
	import subprocess
	try:
		out = subprocess.run(
			["gh", "api", f"/orgs/{org}/packages/container/{enc}/versions?per_page=100",
			 "--paginate", "--jq", ".[] | \"\\(.id)\\t\\(.name)\""],
			capture_output=True, text=True, check=True).stdout
	except subprocess.CalledProcessError:
		continue
	for line in out.splitlines():
		if "\t" in line:
			i, d = line.split("\t", 1)
			digests[(pkg, i)] = d

_tok = {}
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
	except Exception:
		_tok[pkg] = None
	return _tok[pkg]

ACCEPT = ",".join([
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.v2+json",
])

def children(pkg, digest):
	tok = bearer(pkg)
	if not tok:
		return []
	req = urllib.request.Request(f"https://ghcr.io/v2/{org}/{pkg}/manifests/{digest}")
	req.add_header("Authorization", f"Bearer {tok}")
	req.add_header("Accept", ACCEPT)
	try:
		with urllib.request.urlopen(req, timeout=30) as r:
			return [x["digest"] for x in json.load(r).get("manifests", [])]
	except Exception:
		return []

listed = {(r["pkg"], digests.get((r["pkg"], r["id"]), "")) for r in rows}
problems = []
for r in rows:
	d = digests.get((r["pkg"], r["id"]))
	if not d:
		continue
	for c in children(r["pkg"], d):
		if (r["pkg"], c) not in listed:
			problems.append(f"{r['pkg']} index {d[:19]} is listed but its child {c[:19]} is not")

for p in problems:
	print(p)
EOPY
)

if [ -n "$SPLIT" ]; then
	echo "" >&2
	echo "! Split multi-arch group detected:" >&2
	echo "$SPLIT" | sed 's/^/    /' >&2
	echo "" >&2
	if [ "$ALLOW_SPLIT" = "0" ]; then
		echo "  Deleting an index without its children (or vice versa) can leave a" >&2
		echo "  broken image. Either add the missing rows back to the list, remove" >&2
		echo "  the whole group, or re-run with --allow-split-group." >&2
		exit 1
	fi
	echo "  --allow-split-group given; continuing anyway." >&2
fi

# --- Summary --------------------------------------------------------------
echo ""
echo "Versions to delete, by package:"
cut -f1 "$WORK/rows.tsv" | sort | uniq -c | sort -rn | sed 's/^/  /'
echo ""

if [ "$CONFIRM" = "0" ]; then
	echo "DRY RUN -- nothing deleted. Re-run with --confirm to delete these $ROWS versions."
	exit 0
fi

# --- Delete ---------------------------------------------------------------
OK=0; FAIL=0
: > "$WORK/failed.tsv"
while IFS=$'\t' read -r pkg id grp; do
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
done < "$WORK/rows.tsv"

echo ""
echo "==> Deleted $OK, failed $FAIL of $ROWS"
if [ "$FAIL" -gt 0 ]; then
	echo "Failures:" >&2
	cat "$WORK/failed.tsv" >&2
	exit 1
fi
