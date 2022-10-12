#!/usr/bin/env bash

# Myriac "batteries included installation" script; installs data science
# runtime, tooling, and extensions into the dev container so that it's ready to
# use right away.
#
# This wraps the restore-diff script that is the only post-create command
# formerly executed by the VS Code dev container.
#
# After changing this script, use the "Remote Container - Rebuild Dev Container
# Without Cache" command in VS Code to test your changes.

echo "Setting up Myriac dev environment...."
sudo apt update

# Install Python infrastructure; the dev container already contains Python, but not pip.
echo "*** Installing pip package manager"
sudo apt --assume-yes install python3-pip

# Install key Python packages
echo "*** Installing key Python packages"
pip3 install ipython ipykernel pandas numpy matplotlib

# Install R base system
echo "*** Installing R base system"
sudo apt --assume-yes install r-base

# Install key R packages; the dev container doesn't have a writeable system
# library, so create a user library first and write everything there.
echo "*** Installing key R packages"
RPKGLIB=$(Rscript -e 'cat(path.expand(Sys.getenv("R_LIBS_USER")))')
mkdir -p "$RPKGLIB"
Rscript -e "install.packages(c('rmarkdown', 'renv', 'shiny', 'testthat', 'tidyverse', 'tinytex'), repos='https://cran.rstudio.com/')"
Rscript -e "tinytex::install_tinytex()"

# Install Myriac extensions from OpenVSX. Note that this list of extensions
# differs from the one in `devcontainer.json`; that one controls the extensions
# installed in the VS Code host, whereas this one installs extensions into the
# development/working copy of Myriac.
#
# TODO: This may not succeed since the `code` binary isn't available in the
# image at the post-create step.
echo "*** Installing extensions from OpenVSX..."
code --install-extension ms-python.python
code --install-extension ms-toolsai.jupyter

# Find and execute the restore-diff script, which unpacks the cached yarn install (in cache.tar)
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";
$SCRIPT_DIR/restore-diff.sh

