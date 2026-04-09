# Runner Launch Reference

Launch commands are in the IMMEDIATE section of SKILL.md. This file is supplementary.

## Port File

Each session uses a unique port file via `EXPLORE_PORT_FILE` env var (defaults to
`/tmp/explore-runner-port` if not set). The SKILL.md sets this to
`/tmp/explore-runner-port-$$` where `$$` is the shell PID.

## Readiness

The runner writes the port file when ready (~30-60s boot). With the parallel launch
pattern, it has a 30-40s head start. Skip the poll loop and go straight to `/describe`.
If the port file doesn't exist, retry once after 5s.

## POM Reference Staleness

Regenerate if missing or any POM source file is newer:
```bash
REF=test/e2e/tests/_generated/pom-reference.md
if [ ! -f "$REF" ] || [ -n "$(find test/e2e/pages -name '*.ts' -newer "$REF" 2>/dev/null | head -1)" ]; then
  npx tsx scripts/generate-pom-reference.ts
fi
```
