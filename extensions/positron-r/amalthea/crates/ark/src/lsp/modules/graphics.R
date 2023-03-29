#
# graphics.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

.ps.graphics.initializeDevice <- function(index, name, type, res) {

    attributes(name) <- attributes(.Devices[[index]])
    attr(name, "type") <- type
    attr(name, "res") <- res
    .Devices[[index]] <- name

    .ps.binding.replace(".Devices", .Devices, envir = baseenv())
    .ps.binding.replace(".Device", name, envir = baseenv())

}


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
    #
    # TODO: What about other things like DPI, and so on?
    size <- dev.size(units = "px")
    res <- attr(device, "res") %??% 144
    type <- attr(device, "type") %??% "cairo"
    width <- size[[1L]]
    height <- size[[2L]]

    # Copy to a new graphics device.
    # TODO: We'll want some indirection around which graphics device is selected here.
    filepath <- attr(device, "filepath")
    dev.copy(function() {
        grDevices::png(
            filename = filepath,
            width    = width,
            height   = height,
            res      = res,
            type     = type
        )
    })

    # Turn off the graphics device.
    dev.off()

    # For debugging; open the rendered plot.
    system(paste("open", shQuote(filepath)))

}
