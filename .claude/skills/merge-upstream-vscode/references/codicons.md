# Codicons

Positron has added its own codicons to Code OSS, which generates merge conflicts
with upstream.

If there is a conflict in `codicon.ttf` or `codiconLibrary.ts`, then the
codicons need to be rebuilt to incorporate both changes. This cannot be done in
the Positron repository alone, so:

- accept the incoming binary ttf file to fix the merge conflict
- clean up markers in `codiconLibrary.ts` so it contains both sets of icons
- note in the merge log file that codicons need to be rebuilt
