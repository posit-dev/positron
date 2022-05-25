#!/usr/bin/env bash

# Myriac "batteries included installation" script; installs data science
# runtime, tooling, and extensions into the dev container so that it's ready to
# use right away.
#
# This wraps the restore-diff script that is the only post-create command
# formerly executed by the VS Code dev container.

echo "Setting up Myriac dev environment...."

# Install Python infrastructure; the dev container already contains Python, but not pip.
echo "*** Installing pip package manager"
sudo apt install python3-pip

# Install key Python packages
echo "*** Installing key Python packages"
pip3 install ipython ipykernel pandas numpy matplotlib

# Install R base system
echo "*** Installing R base system"
sudo apt install r-base

# Install key R packages; the dev container doesn't have a writeable system
# library, so create a user library first and write everything there.
echo "*** Installing key R packages"
RPKGLIB=$(Rscript -e 'cat(path.expand(Sys.getenv("R_LIBS_USER")))')
mkdir -p "$RPKGLIB"
Rscript -e "install.packages(c('rmarkdown', 'renv', 'shiny', 'testthat', 'tidyverse'), repos='https://cran.rstudio.com/')"

# Find and execute the restore-diff script, which unpacks the cached yarn install (in cache.tar)
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";
$SCRIPT_DIR/restore-diff.sh

