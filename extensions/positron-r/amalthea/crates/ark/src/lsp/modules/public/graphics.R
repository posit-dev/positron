#
# graphics.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

.ps.graphics.defaultResolution <- if (Sys.info()[["sysname"]] == "Darwin") 96L else 72L

.ps.graphics.createDevice <- function(name, type, res) {

    # Get path where plots will be generated.
    snapshotFolder <- .ps.graphics.snapshotFolder()
    dir.create(snapshotFolder, showWarnings = FALSE, recursive = TRUE)
    plotsPath <- file.path(snapshotFolder, "last-rendered-plot.png")

    # Create the graphics device.
    # TODO: Use 'ragg' if available?
    grDevices::png(
        filename = plotsPath,
        type = type,
        res = res
    )

    # Update the device name + description in the base environment.
    index <- dev.cur()
    oldDevice <- .Devices[[index]]
    newDevice <- name

    # Copy device attributes. Usually, this is just the file path.
    attributes(newDevice) <- attributes(oldDevice)

    # Set other device properties.
    attr(newDevice, "type") <- type
    attr(newDevice, "res") <- res

    # Update the devices list.
    .Devices[[index]] <- newDevice

    # Replace bindings.
    .ps.binding.replace(".Devices", .Devices, envir = baseenv())
    .ps.binding.replace(".Device", newDevice, envir = baseenv())

}

.ps.graphics.snapshotFolder <- function(...) {
    file.path(tempdir(), "positron-snapshots", ...)
}

# Create a snapshot of the current plot.
#
# This saves the plot's display list, so it can be used
# to re-render plots as necessary.
.ps.graphics.createSnapshot <- function(id) {

    # create snapshot folder path
    folder <- .ps.graphics.snapshotFolder(id)
    dir.create(folder, showWarnings = FALSE, recursive = TRUE)

    # save plot to file
    recordedPlot <- recordPlot()
    snapshotPath <- file.path(folder, "snapshot.rds")
    saveRDS(recordedPlot, file = snapshotPath)

    # return path to snapshot file
    snapshotPath

}

.ps.graphics.replaySnapshot <- function(id) {

    tryCatch(
        .ps.graphics.replaySnapshotImpl(id),
        error = warning
    )
}

.ps.graphics.replaySnapshotImpl <- function(id) {

    plotsPath <- .ps.graphics.snapshotFolder(id, "snapshot.rds")
    recordedPlot <- readRDS(plotsPath)
    replayPlot(recordedPlot)
    .ps.graphics.renderPlot(id)

}


.ps.graphics.renderPlot <- function(id, width, height, dpr) {

    # Try and force the graphics device to sync changes.
    dev.set(dev.cur())
    dev.flush()

    # Get the file name associated with the current graphics device.
    device <- .Devices[[dev.cur()]]

    # Get device attributes to be passed along.
    #
    # TODO: What about other things like DPI, and so on?
    size <- dev.size(units = "px")
    type <- attr(device, "type") %??% "cairo"
    res <- .ps.graphics.defaultResolution * dpr
    width <- width * dpr
    height <- height * dpr

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

    # Read the contents of the generated PNG file, and then base64-encode it.
    contents <- readBin(filepath, what = "raw", n = file.size(filepath))
    base64enc::base64encode(contents)

}
