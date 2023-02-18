#
# graphics.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

# Render a plot to file.
#
# We use 'dev.copy()' to copy the current state of the graphics
# device to a new device, and the immediately shut that device
# off to force it to render to file.
.ps.graphics.renderPlot <- function() {

    # Try and force the graphics device to sync changes.
    dev.set(dev.cur())
    dev.flush()

    # Get the file name associated with the current graphics device.
    device <- .Devices[[dev.cur()]]

    # Get device attributes to be passed along.
    # TODO: What about other things like DPI, and so on?
    size <- dev.size()
    width <- size[[1L]]
    height <- size[[2L]]
    units <- "in"
    res <- 72L

    # Copy to a new graphics device.
    dev.copy(
        device = grDevices:::png,
        filename = attr(device, "filepath"),
        width = width,
        height = height,
        units = units,
        res = res
    )

    # Turn off the graphics device.
    dev.off()

}

.ps.graphics.updateDeviceName <- function(name, index) {

    attributes(name) <- attributes(.Devices[[index]])
    .Devices[[index]] <- name

    .ps.replaceBinding(".Devices", .Devices, envir = baseenv())
    .ps.replaceBinding(".Device", name, envir = baseenv())

}

