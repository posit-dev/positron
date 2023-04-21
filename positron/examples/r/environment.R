
# scalars
a <- 1L
b <- TRUE
c <- 2.3
d <- 1+1i
e <- "hello"
f <- as.raw(2)

# vectors
g <- 1:10
h <- g > 5
i <- g + .5
j <- paste0("-", g, "-")
k <- as.raw(g)

# factors
fct <- iris$Species

# matrices
mat_numbers <- matrix(1:12, nrow = 2)
mat_letters <- matrix(letters, ncol = 2)

# data.frame
iris <- iris
mtcars <- mtcars
df <- data.frame(
    g = g,
    h = h,
    i = i,
    j = j,
    k = k
)

# function
lm <- lm

# promise
delayedAssign("promise", rnorm(10), globalenv(), globalenv())

# active binding
makeActiveBinding("active", function() 42, globalenv())

# S4
track <- setClass("track", slots = c(x="numeric", y="numeric"))
## an object from the class
t1 <- track(x = 1:10, y = 1:10 + rnorm(10))

## A class extending the previous, adding one more slot
trackCurve <- setClass("trackCurve",
		slots = c(smooth = "numeric"),
		contains = "track")

## an object containing a superclass object
t1s <- trackCurve(t1, smooth = 1:10)

## A class that extends the built-in data type "numeric"

numWithId <- setClass("numWithId", slots = c(id = "character"),
         contains = "numeric")

num <- numWithId(1:3, id = "An Example")

## inherit from reference object of type "environment"
stampedEnv <- setClass("stampedEnv", contains = "environment", slots = c(update = "POSIXct"))
setMethod("[[<-", c("stampedEnv", "character", "missing"),
   function(x, i, j, ..., value) {
       ev <- as(x, "environment")
       ev[[i]] <- value  #update the object in the environment
       x@update <- Sys.time() # and the update time
       x})


e1 <- stampedEnv(update = Sys.time())

e1[["noise"]] <- rnorm(10)

# R6
library(R6)

Queue <- R6Class("Queue",
  public = list(
    initialize = function(...) {
      for (item in list(...)) {
        self$add(item)
      }
    },
    add = function(x) {
      private$queue <- c(private$queue, list(x))
      invisible(self)
    },
    remove = function() {
      if (private$length() == 0) return(NULL)
      # Can use private$queue for explicit access
      head <- private$queue[[1]]
      private$queue <- private$queue[-1]
      head
    }
  ),
  private = list(
    queue = list(),
    length = function() base::length(private$queue)
  )
)

q <- Queue$new(5, 6, "foo")

Numbers <- R6Class("Numbers",
  public = list(
    x = 100
  ),
  active = list(
    x2 = function(value) {
      if (missing(value)) return(self$x * 2)
      else self$x <- value/2
    },
    rand = function() rnorm(1)
  )
)

n <- Numbers$new()

HistoryQueue <- R6Class("HistoryQueue",
  inherit = Queue,
  public = list(
    show = function() {
      cat("Next item is at index", private$head_idx + 1, "\n")
      for (i in seq_along(private$queue)) {
        cat(i, ": ", private$queue[[i]], "\n", sep = "")
      }
    },
    remove = function() {
      if (private$length() - private$head_idx == 0) return(NULL)
      private$head_idx <<- private$head_idx + 1
      private$queue[[private$head_idx]]
    }
  ),
  private = list(
    head_idx = 0
  )
)

hq <- HistoryQueue$new(5, 6, "foo")
