# Positron Version Commits

This folder contains the base, or "anchor" commit for each Positron version.
Build numbers are computed relative to the anchor commit.

For example, Positron version 2022.10.0-456 is 456 commits past the commit
stored in 2022.10.0.commit.

## Creating a New Positron Version

To create a new Positron version, do the following:

1. Change `positronVersion` in the `product.json` file at the root of the repository
2. Change `positronVersion` in `src/vs/platform/product/common/product.ts` to match (web dev builds read the version from here)
3. From a shell, run `./versions/create-anchor.cjs` to create a new anchor `.commit` file
4. Run `./versions/show-version.cjs` to check that it prints the new version
5. Commit the changes to `product.json` and `product.ts` and the new `.commit` file

## Patch Releases

For a patch release (e.g. 2026.10.1), make the same changes on the existing `release/<version>` branch instead of `main`, and open the PR against that branch.
Do this before landing the patch's fixes: the script records the branch's current `HEAD` as the anchor, and the fixes that land after it give the patch its build numbers.
