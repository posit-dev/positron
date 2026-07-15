badFunction<-function(x,y){
if(x> y){
print( "x is greater than y")}
else{
print("x is less than or equal to y" )
  }
for(i in 1:10){
print( paste( "Number is",i ) )
if(i%%2==0){print("Even")}else{print("Odd")}
}
sum<-x +y
return( sum )
}