#!/usr/bin/env bash
# Build a human-reviewable deletion candidate list for old GHCR container images.
# Read-only: never deletes anything.
set -euo pipefail

ORG="posit-dev"
AGE_DAYS=90
PATTERN='^positron-(postgres|ubuntu|rocky|debian|opensuse|sles|windows|amazonlinux|fedora|alpine|centos)'
REPO_PATH=""
OUT=""
PROTECT_TAGS=""

usage() {
	cat <<'EOF'
Usage: ghcr-audit.sh [options]

  --org ORG            GitHub org that owns the packages (default: posit-dev)
  --age-days N         Candidates must be older than N days (default: 90)
  --pattern REGEX      ERE matched against package names
  --repo-path PATH     Repo checkout to scan for in-use image tags (default: none)
  --protect-tag TAG    Extra tag to treat as in-use (repeatable)
  --out FILE           Write the review list here (default: stdout)
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--org) ORG="$2"; shift 2 ;;
		--age-days) AGE_DAYS="$2"; shift 2 ;;
		--pattern) PATTERN="$2"; shift 2 ;;
		--repo-path) REPO_PATH="$2"; shift 2 ;;
		--protect-tag) PROTECT_TAGS="$PROTECT_TAGS $2"; shift 2 ;;
		--out) OUT="$2"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "unknown option: $1" >&2; usage; exit 2 ;;
	esac
done

command -v gh >/dev/null || { echo "gh not found" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

GH_USER="$(gh api user --jq .login)"
GH_TOKEN_VAL="$(gh auth token)"

echo "==> Listing container packages in $ORG" >&2
gh api "/orgs/$ORG/packages?package_type=container&per_page=100" --paginate --jq '.[].name' \
	| grep -E "$PATTERN" | sort > "$WORK/pkgs.txt" || true

PKG_COUNT=$(wc -l < "$WORK/pkgs.txt" | tr -d ' ')
if [ "$PKG_COUNT" = "0" ]; then
	echo "No packages matched pattern: $PATTERN" >&2
	exit 1
fi
echo "==> $PKG_COUNT packages matched" >&2

# --- Fetch every version of every matched package -------------------------
: > "$WORK/versions.jsonl"
while read -r pkg; do
	[ -n "$pkg" ] || continue
	enc="${pkg//\//%2F}"
	gh api "/orgs/$ORG/packages/container/$enc/versions?per_page=100" --paginate \
		--jq ".[] | {pkg:\"$pkg\", id:.id, digest:.name, tags:(.metadata.container.tags // []), updated:.updated_at, url:.html_url}" \
		>> "$WORK/versions.jsonl" 2>/dev/null || echo "  ! could not read versions for $pkg" >&2
done < "$WORK/pkgs.txt"
echo "==> $(wc -l < "$WORK/versions.jsonl" | tr -d ' ') versions fetched" >&2

# --- Scan the repo for in-use "<pkg>:<tag>" references --------------------
: > "$WORK/inuse.txt"
if [ -n "$REPO_PATH" ]; then
	echo "==> Scanning $REPO_PATH for in-use image tags" >&2
	for d in .github docker test scripts build; do
		[ -d "$REPO_PATH/$d" ] || continue
		grep -rhoE "ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+" "$REPO_PATH/$d" 2>/dev/null \
			| sed -E 's#^ghcr\.io/[^/]+/##' >> "$WORK/inuse.txt" || true
	done
	sort -u -o "$WORK/inuse.txt" "$WORK/inuse.txt"
	echo "==> $(wc -l < "$WORK/inuse.txt" | tr -d ' ') distinct in-use tag refs found" >&2
fi
for t in $PROTECT_TAGS; do echo "*:$t" >> "$WORK/inuse.txt"; done

# --- Classify, then resolve manifest children of everything we keep -------
export WORK ORG AGE_DAYS GH_USER GH_TOKEN_VAL OUT
python3 <<'EOPY'
import json, os, subprocess, sys, urllib.request, urllib.error, base64
from datetime import datetime, timezone, timedelta

work = os.environ["WORK"]
org = os.environ["ORG"]
age_days = int(os.environ["AGE_DAYS"])
gh_user = os.environ["GH_USER"]
gh_token = os.environ["GH_TOKEN_VAL"]

cutoff = datetime.now(timezone.utc) - timedelta(days=age_days)

versions = []
with open(f"{work}/versions.jsonl") as fh:
	for line in fh:
		line = line.strip()
		if line:
			versions.append(json.loads(line))

inuse = set()
try:
	with open(f"{work}/inuse.txt") as fh:
		inuse = {l.strip() for l in fh if l.strip()}
except FileNotFoundError:
	pass
inuse_any_pkg = {r.split(":", 1)[1] for r in inuse if r.startswith("*:")}

def tag_in_use(pkg, tags):
	for t in tags:
		if f"{pkg}:{t}" in inuse or t in inuse_any_pkg:
			return t
	return None

# Pass 1: provisional keep/candidate decision.
for v in versions:
	v["dt"] = datetime.strptime(v["updated"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
	v["age_days"] = (datetime.now(timezone.utc) - v["dt"]).days
	v["inuse_tag"] = tag_in_use(v["pkg"], v["tags"])
	v["keep_reason"] = None
	if v["inuse_tag"]:
		v["keep_reason"] = f"tag `{v['inuse_tag']}` referenced in repo"
	elif v["dt"] >= cutoff:
		v["keep_reason"] = f"newer than {age_days}d"

# Registry token cache, for resolving manifest lists to their children.
_tok = {}
def bearer(pkg):
	if pkg in _tok:
		return _tok[pkg]
	url = f"https://ghcr.io/token?service=ghcr.io&scope=repository:{org}/{pkg}:pull"
	req = urllib.request.Request(url)
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
	"""Return child digests if this version is a manifest list/index, else []."""
	tok = bearer(pkg)
	if not tok:
		return None
	req = urllib.request.Request(f"https://ghcr.io/v2/{org}/{pkg}/manifests/{digest}")
	req.add_header("Authorization", f"Bearer {tok}")
	req.add_header("Accept", ACCEPT)
	try:
		with urllib.request.urlopen(req, timeout=30) as r:
			m = json.load(r)
	except Exception:
		return None
	return [x["digest"] for x in m.get("manifests", [])]

# Pass 2: any child of a KEPT index is itself protected. Resolve kept versions only.
kept = [v for v in versions if v["keep_reason"]]
print(f"==> Resolving manifests for {len(kept)} retained versions", file=sys.stderr)
protected = {}   # (pkg, digest) -> parent description
unresolved = []
for v in kept:
	ch = children(v["pkg"], v["digest"])
	if ch is None:
		unresolved.append(v)
		continue
	for c in ch:
		tagdesc = ",".join(v["tags"]) or v["digest"][:19]
		protected[(v["pkg"], c)] = tagdesc

# Pass 3: group candidates with their own children so a group is deleted atomically.
cand = [v for v in versions if not v["keep_reason"]]
child_of_cand = {}
for v in cand:
	ch = children(v["pkg"], v["digest"])
	if ch is None:
		# Never assume "no children" on a failed read -- that would let an
		# index be listed without its per-arch manifests.
		unresolved.append(v)
		v["children"] = []
		continue
	v["children"] = ch
	for c in v["children"]:
		child_of_cand[(v["pkg"], c)] = v["digest"]

rows = []
skipped_protected = []
for v in cand:
	key = (v["pkg"], v["digest"])
	if key in protected:
		v["protected_by"] = protected[key]
		skipped_protected.append(v)
		continue
	parent = child_of_cand.get(key)
	group = (parent or v["digest"])[:19]
	if v["tags"]:
		kind = "tagged"
	elif parent:
		kind = "arch child"
	else:
		kind = "untagged"
	rows.append({**v, "group": group, "kind": kind})

# Warn when a package would be emptied entirely.
by_pkg_total = {}
by_pkg_del = {}
for v in versions:
	by_pkg_total[v["pkg"]] = by_pkg_total.get(v["pkg"], 0) + 1
for v in rows:
	by_pkg_del[v["pkg"]] = by_pkg_del.get(v["pkg"], 0) + 1
emptied = sorted(p for p in by_pkg_del if by_pkg_del[p] == by_pkg_total[p])

rows.sort(key=lambda v: (v["pkg"], -v["age_days"]))

out = []
w = out.append
now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
w(f"# GHCR image deletion review list")
w("")
w(f"- Generated: {now}")
w(f"- Org: `{org}`")
w(f"- Cutoff: older than **{age_days} days** (before {cutoff.strftime('%Y-%m-%d')})")
w(f"- Packages scanned: {len(by_pkg_total)}; versions scanned: {len(versions)}")
w(f"- **Deletion candidates: {len(rows)}**; retained: {len(versions) - len(rows)}")
w("")
w("## How to review")
w("")
w("Every row below is scheduled for deletion. **Delete any row you want to KEEP.**")
w("Leave the table formatting intact; do not edit the `id` or `group` columns.")
w("Then hand the file back for the batch delete.")
w("")
w("`group` ties a multi-arch index to its per-arch child manifests. Rows sharing a")
w("group must be kept or deleted together -- the prune step aborts on a split group.")
w("")
if emptied:
	w("## Packages that would be emptied completely")
	w("")
	w("Every version of these packages is a candidate. **GHCR refuses to delete")
	w("the last tagged version of a package**, so the prune step will delete all")
	w("but one and report the final version as a failure. Clearing them needs a")
	w("package-level delete, which is a separate decision -- it removes the")
	w("package from the org list entirely:")
	w("")
	w("```bash")
	for p in emptied:
		w(f"# {p} ({by_pkg_del[p]} of {by_pkg_total[p]} versions)")
	w(f"scripts/ghcr-delete-packages.sh --org {org} \\")
	for i, p in enumerate(emptied):
		cont = " \\" if i < len(emptied) - 1 else ""
		w(f"  --package {p}{cont}")
	w("```")
	w("")
	w("Confirm these images are genuinely retired first.")
	w("")
if skipped_protected:
	w("## Excluded: children of retained images (do not delete)")
	w("")
	w(f"{len(skipped_protected)} old-but-referenced manifests were excluded because a")
	w("retained tag still points at them:")
	w("")
	w("| package | digest | age (d) | referenced by |")
	w("|---|---|---|---|")
	for v in sorted(skipped_protected, key=lambda x: x["pkg"]):
		w(f"| `{v['pkg']}` | `{v['digest'][:19]}` | {v['age_days']} | `{v['protected_by']}` |")
	w("")
if unresolved:
	w("## Warning: manifests that could not be resolved")
	w("")
	w("**Do not prune this list.** These versions could not be read from the")
	w("registry, so their child manifests may be missing from the protected set")
	w("and a live image could be broken. Fix registry access and re-run the audit.")
	w("(ghcr-prune.sh independently re-resolves every manifest and will refuse to")
	w("run while any of them are unreadable.)")
	w("")
	for v in unresolved:
		w(f"- `{v['pkg']}` `{v['digest'][:19]}` (tags: {','.join(v['tags']) or 'none'})")
	w("")
w("## Deletion candidates")
w("")
w("| package | id | tags | age (d) | updated | kind | group |")
w("|---|---|---|---|---|---|---|")
for v in rows:
	tags = ", ".join(f"`{t}`" for t in v["tags"]) or "_untagged_"
	w(f"| `{v['pkg']}` | {v['id']} | {tags} | {v['age_days']} | {v['updated'][:10]} | {v['kind']} | `{v['group']}` |")
w("")

text = "\n".join(out)
outfile = os.environ.get("OUT") or None
if outfile:
	with open(outfile, "w") as fh:
		fh.write(text)
	print(f"==> Wrote {outfile} ({len(rows)} candidates)", file=sys.stderr)
else:
	print(text)
EOPY
