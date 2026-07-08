gen_table <- function(input, output, session) {
  
  dt = data.frame(x = c(1:7,1:7,1:7,2:6,1,7),
                  y = c(rep(4,7),rep(3,7),rep(2,7),rep(1,7)),
                  val = c(toupper(letters),'',''),
                  col = c(rep('blue',26),'white','white'),
                  stringsAsFactors = FALSE)
  
  return(dt)
}
