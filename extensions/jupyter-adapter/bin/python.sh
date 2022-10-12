#!/usr/bin/env sh

# we use this python shim so that we can inject some required
# compilation flags when downstream dependencies are built
#
# https://github.com/rstudio/positron/issues/26
export CPPFLAGS="-D__IMMINTRIN_H"

python "$@"

