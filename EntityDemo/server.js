const express = require('express');
const path = require('path');
const app = express();
const port = 8000;
const cors = require('cors');
// const port = app.config
// NOTE:
app.use(express.static("public"))
//

app.use(cors());
/** 
 * code at the buttom is simpler
 * app.use(express.static(path.join(__dirname,"public" )))
 */




const rappers = {
 "21 savage": {
  "name": "Jones",
  "date of birth": "12/03/1933",
  "description": "hip-hop rapper",
  "location":"london England"
 },
 "mother": {
  "name": "Jones",
  "date of birth": "12/03/1933",
  "description": "hip-hop rapper",
  "location":"london England"
 },
 "father": {
  "name": "Jones",
  "date of birth": "12/03/1933",
  "description": "hip-hop rapper",
      "location":"london England"
 },
 "grand dad": {
  "name": "Jones",
  "date of birth": "12/03/1933",
  "description": "hip-hop rapper",
  "location":"london England"
 },
 "unkown": {
  "name": "Jones",
  "date of birth": "12/03/1933",
  "description": "hip-hop rapper",
  "location":"london England"
 }
}

app.get('/', (req, res) =>{
  res.sendFile(__dirname +'/index.html')
});

app.get('/api/rappers',(req,res)=>{
  res.json(rappers);
});

app.get('/api/rappers/:rappername',(req,res)=>{
  
  const rapName = req.params.rappername.toLocaleLowerCase();
  console.log(rapName);
  if (rappers[rapName]) {
    res.json(rappers[rapName])
  }else{
    res.json('Please enter valid rapper')
  }
});



// app.use(express.Router());
app.listen(port, function(){
  console.log(`app is listening on ${port}`);
});