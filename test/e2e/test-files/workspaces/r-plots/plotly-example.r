library(plotly)
fig <- plot_ly(midwest, x = ~percollege, color = ~state, type = "box")
fig