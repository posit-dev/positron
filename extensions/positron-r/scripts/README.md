# Positron R Extension Scripts

## `install-kernel.ts`

This script handles downloading and installing the Ark R kernel, which is used by the Positron R extension to execute R code.


### Installation Methods

#### Release Mode (Production Use)

- Downloads pre-built binaries from GitHub releases
- Uses a semantic version number like `"0.1.182"`
- Example in package.json:
  ```json
  "positron": {
    "binaryDependencies": {
      "ark": "0.1.182"
    }
  }
  ```


#### Local development mode

For kernel developers working directly on the Ark kernel, the script will check for locally built versions in a sibling `ark` directory before attempting to download or build from source.

Note that this has precedence over downloading Ark based on the version specified in `package.json` (both release and github references).


#### CI development Mode

- Clones and builds the Ark kernel from source using a GitHub repositoryreference
- Uses the format `"org/repo@branch_or_revision"`
- Examples in package.json:
  ```json
  "positron": {
    "binaryDependencies": {
      "ark": "posit-dev/ark@main"                  // Use the main branch
      "ark": "posit-dev/ark@experimental-feature"  // Use a feature branch
      "ark": "posit-dev/ark@a1b2c3d"               // Use a specific commit
      "ark": "posit-dev/ark@v0.1.183"              // Use a specific tag
    }
  }
  ```

The repository reference format (`org/repo@branch_or_revision`) should only be used during development and never be merged into main or release branches. A GitHub Action (`prevent-repo-references.yml`) enforces this restriction by checking pull requests to main and release branches for this pattern.


### Authentication

When accessing GitHub repositories or releases, the script attempts to find a GitHub Personal Access Token (PAT) in the following order:

1. The `GITHUB_PAT` environment variable
2. The `POSITRON_GITHUB_RO_PAT` environment variable
3. The git config setting `credential.https://api.github.com.token`

Providing a PAT is recommended to avoid rate limiting and to access private repositories.


## `compile-syntax.ts`

This script compiles TextMate grammar files for syntax highlighting.


## `post-install.ts`

This script performs additional setup steps after the extension is installed.
