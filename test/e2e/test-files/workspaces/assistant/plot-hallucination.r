# Produces a simple plot with a value at 0,0
plot(0, 0, xlim = c(0, 1), ylim = c(0, 1))

# Add a random number between 0 and 100 at the center of the plot with random color
text(
  0.5,
  0.5,
  labels = round(runif(1, 0, 100)),
  cex = 2,
  col = sample(
    c("red", "blue", "green", "orange", "purple", "pink", "brown", "cyan"),
    1
  )
)

# Check if the number displayed in the plot is properly identified by the LLM,
# both the number itself and its color.
