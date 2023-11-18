#' Test reporter: VS Code format.
#'
#' This reporter will output results in a format understood by the
#' [R Test Explorer](https://github.com/meakbiyik/vscode-r-test-adapter).
#'
#' @export
VSCodeReporter <- R6::R6Class("VSCodeReporter",
  inherit = Reporter,
  private = list(
    filename = NULL
  ),
  public = list(

    initialize = function(...) {
      super$initialize(...)
      private$filename <- NULL
      self$capabilities$parallel_support <- TRUE
      # FIXME: self$capabilities$parallel_updates <- TRUE
    },

    start_reporter = function() {
      self$cat_json(list(type = "start_reporter"))
    },

    start_file = function(filename) {
      self$cat_json(list(type = "start_file", filename = filename))
      private$filename <- filename
    },

    start_test = function(context, test) {
      self$cat_json(list(type = "start_test", test = test))
    },

    add_result = function(context, test, result) {
      test_result <- list(
        type = "add_result",
        context = context,
        test = test,
        result = expectation_type(result),
        location = expectation_location(result),
        filename = expectation_filename(result)
      )
      if (!is.null(expectation_message(result))) {
        test_result[["message"]] <- expectation_message(result)
      }
      self$cat_json(test_result)
    },

    end_test = function(context, test) {
      self$cat_json(list(type = "end_test", test = test))
    },

    end_file = function() {
      self$cat_json(list(type = "end_file", filename = private$filename))
      private$filename <- NULL
    },

    end_reporter = function() {
      self$cat_json(list(type = "end_reporter"))
    },

    cat_json = function(x) {
      self$cat_line(jsonlite::toJSON(x, auto_unbox = TRUE))
      flush.console()
    }
  )
)

expectation_type <- function(exp) {
  stopifnot(is.expectation(exp))
  gsub("^expectation_", "", class(exp)[[1]])
}

expectation_success <- function(exp) expectation_type(exp) == "success"
expectation_failure <- function(exp) expectation_type(exp) == "failure"
expectation_error   <- function(exp) expectation_type(exp) == "error"
expectation_skip    <- function(exp) expectation_type(exp) == "skip"
expectation_warning <- function(exp) expectation_type(exp) == "warning"
expectation_broken  <- function(exp) expectation_failure(exp) || expectation_error(exp)
expectation_requires_message  <- function(exp) expectation_broken(exp) || expectation_skip(exp)
expectation_ok      <- function(exp) expectation_type(exp) %in% c("success", "warning")

expectation_message <- function(x) {
  if (expectation_requires_message(x)) {
    x$message
  } else {
    NULL
  }
}

expectation_filename <- function(x) {
  return(
    if(is.null(x$srcref)) "" else attr(x$srcref, "srcfile")$filename
  )
}

expectation_location <- function(x) {
  if (is.null(x$srcref)) {
    "???"
  } else {
    filename <- attr(x$srcref, "srcfile")$filename
    if (identical(filename, "")) {
      paste0("Line ", x$srcref[1])
    } else {
      paste0(basename(filename), ":", x$srcref[1], ":", x$srcref[2])
    }
  }
}
