

// alert('hello world');

var homeElement = document.querySelector(".headH1");
addEventListener("click", changeColor);
function changeColor(){
  homeElement.style.color = "red";
}
homeElement.style.backgroundColor ="white";

document.querySelector(".ulMenu").classList.add(".hide");
var buttonMenu = document.querySelector('button');
buttonMenu.addEventListener("click",toggleMenu);
function toggleMenu(){
 document.querySelector(".ulMenu").classList.toggle("hide");
}
 
document.querySelector('.click--btn').addEventListener('click', getRapper);

async function getRapper(){
  // const res = await fetch('http://localhost:8000/api/rappers')
  // .then((res) => res.json())
  // .then((data) =>{
  //   console.log(data);
  // });
  // OR

  const rappersInformation = document.querySelector('#rapper--name').value
  try {
  const res = await fetch(`http://localhost:8000/api/rappers/${rappersInformation}`)
  const data = await res.json();
  console.log(data);
  document.querySelector('.RapperInfo').innerText = data.name;
  }catch(err){
    console.log(err)
  }
}




