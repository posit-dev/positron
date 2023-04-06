#
# graphics.R
#
# Copyright (C) 2022 by Posit Software, PBC
#
#

# Set up plot hooks.
setHook("before.plot.new", function(...) {
    .Call("ps_graphics_event", "before.plot.new", PACKAGE = "(embedding)")
}, action = "replace")

setHook("before.grid.newpage", function(...) {
    .Call("ps_graphics_event", "before.grid.newpage", PACKAGE = "(embedding)")
}, action = "replace")

.ps.graphics.defaultResolution <- if (Sys.info()[["sysname"]] == "Darwin") 96L else 72L

.ps.graphics.plotSnapshotRoot <- function(...) {
    file.path(tempdir(), "positron-snapshots", ...)
}

.ps.graphics.plotSnapshotPath <- function(id) {
    root <- .ps.graphics.plotSnapshotRoot(id)
    ensure_directory(root)
    file.path(root, "snapshot.rds")
}

.ps.graphics.plotOutputPath <- function(id) {
    root <- .ps.graphics.plotSnapshotRoot(id)
    ensure_directory(root)
    file.path(root, "snapshot.png")
}

.ps.graphics.createDevice <- function(name, type, res) {

    # Get path where plots will be generated.
    plotsPath <- .ps.graphics.plotSnapshotRoot("current-plot.png")
    ensure_parent_directory(plotsPath)

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

# Create a snapshot of the current plot.
#
# This saves the plot's display list, so it can be used
# to re-render plots as necessary.
.ps.graphics.createSnapshot <- function(id) {

    # Flush any pending plot actions.
    dev.set(dev.cur())
    dev.flush()

    # Create the plot snapshot.
    recordedPlot <- recordPlot()

    # Get the path to the plot snapshot file.
    snapshotPath <- .ps.graphics.plotSnapshotPath(id)

    # Save it to disk.
    saveRDS(recordedPlot, file = snapshotPath)

    # Return the path to that snapshot file.
    snapshotPath

}

.ps.graphics.renderPlot <- function(id, width, height, dpr) {

    # If we have an existing snapshot, render from that file.
    snapshotPath <- .ps.graphics.plotSnapshotPath(id)
    if (file.exists(snapshotPath))
        .ps.graphics.renderPlotFromSnapshot(id, width, height, dpr)
    else
        .ps.graphics.renderPlotFromCurrentDevice(id, width, height, dpr)

}

.ps.graphics.renderPlotFromSnapshot <- function(id, width, height, dpr) {

    # Get path to snapshot file + output path.
    outputPath <- .ps.graphics.plotOutputPath(id)
    snapshotPath <- .ps.graphics.plotSnapshotPath(id)

    # Read the snapshot data.
    recordedPlot <- readRDS(snapshotPath)

    # Get device attributes to be passed along.
    type <- "cairo"
    res <- .ps.graphics.defaultResolution * dpr
    width <- width * dpr
    height <- height * dpr

    # Create a new graphics device.
    grDevices::png(
        filename = outputPath,
        width    = width,
        height   = height,
        res      = res,
        type     = type
    )

    # Replay the plot.
    suppressWarnings(grDevices::replayPlot(recordedPlot))

    # Turn off the device (commit the plot to disk)
    dev.off()

    # Return path to generated plot file.
    invisible(outputPath)

}

.ps.graphics.renderPlotFromCurrentDevice <- function(id, width, height, dpr) {

    # Try and force the graphics device to sync changes.
    dev.set(dev.cur())
    dev.flush()

    # Get the file name associated with the current graphics device.
    device <- .Devices[[dev.cur()]]

    # Get device attributes to be passed along.
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

    # Return path to the generated file.
    invisible(filepath)

}
