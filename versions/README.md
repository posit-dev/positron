# Positron Version Commits

This folder contains the base, or "anchor" commit for each Positron version.
Patch versions are computed relative to the anchor commit.

For example, Positron version 2022.10.0-456 is 456 commits past the commit
stored in 2022.10.0.commit.

## Creating a New Positron Version

To create a new Positron version, do the following:

1. Change `positronVersion` in the `product.json` file at the root of the repository
2. From a shell, run `./versions/create-anchor.js` to create a new anchor `.commit` file
3. Commit the change to `product.json` and the new `.commit` file

