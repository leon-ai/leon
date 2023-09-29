function remainingLifeTime(age) {
  var yearRemaining = 90 - age;
  var daysOfTheYear = yearRemaining * 356;
  var daysOfTheWeek = yearRemaining * 52;
  var monthRemaining = yearRemaining * 12;


  console.log("you have " + daysOfTheYear + " days ", daysOfTheWeek + " weeks", "and " + monthRemaining + " month left")
  
}
remainingLifeTime(40);


//code Leap year
function isThisALeapYear(year){
  if(year % 4 === 0){
      console.log("this is a leap year");
      if(year % 100 === 0){
          console.log("yes leap year second");
          if(year % 400 ===0){
              console.log("yeess")
          }else{
             return("nooo")
          }
      }else{
          return("second not a leap year")
      }
  }else{
      return("1 no not a leap year")
  } 
}

isThisALeapYear(20);


//GuestList
var guestList = ["susan","john","Mocha","pamela","franka"];
// guestList.foreach(guestLis => guestLis.toLowerCase());
console.log(guestList[1]);
var guestName = prompt("please enter you name!")
if(guestList.includes(guestName)){
    alert("welcome "+ guestName + " to the party!")
}else{
    alert("sorry for any inconviniece cause! Please checck with your admin");
}

// Random Funtion(Takes in and array and randonmises it); 
var myclass = ["jone","Andy","Brandon"];
var peoplenames = ["nana","Tazoh","Frederick","stacy","Aboh"]
function whosPaying(peoplenames) {
    
    var namepostionInArray = peoplenames.length;
    var randomPersonposition = Math.floor(Math.random() * namepostionInArray);
    var randomperson = peoplenames[randomPersonposition]
    console.log("Hello "+randomperson +" will be paying for all lunch today!");
 
}
whosPaying(myclass)
