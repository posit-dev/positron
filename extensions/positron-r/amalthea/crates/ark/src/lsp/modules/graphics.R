#
# graphics.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

.ps.graphics.updateDeviceName <- function(name, index) {

    .Devices <- .Devices
    .Devices[[index]] <- name

    .ps.replaceBinding(".Devices", .Devices, envir = baseenv())
    .ps.replaceBinding(".Device", name, envir = baseenv())

}
