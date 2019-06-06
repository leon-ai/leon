![Logo](https://zupimages.net/up/19/23/fn36.png)
# Leon Weather

The Leon Weather Package contains modules related with the weather.

## Features already available

- Ask for the weather and temperatures in any cities in the world

  ```
  User : Can you tell me the weather in Paris ?
  Leon : The weather in paris is clear andthe temperature is 28°C.
  ```

- Ask for the weather and temperatures for 5 days in future with correct conjugation:

  ```
  User : Can you tell me the weather in Paris tomorrow?
  Leon : The weather in Paris on 2019-06-06 at 12:00:00 will be rain and the temperature will be 18.4 °C.
  ```

  Default hour is 12:00:00.

- Ask the weather every 3 hours:

  ```
  User :What's the weather in Paris in 3 hours ?
  Leon : The weather in Paris on 2019-06-06 at 04:15:08 will be clear and the temperature will be 9.7°C.
  ```

  ```
  User : What's the weather in paris tomorrow at 09:00 AM?
  Leon : The weather in Paris on 2019-06-07 at 09:00:00 will be rain and the temperature will be 15.7°C.
  ```

- Ask temperatures in Celsuis, Fahrenheit and Kelvin by changing config file:

  ```json
  {
  	"weather": {
  		"API_key": "0000",
  		"Measure":"C", <--- HERE 'C'|'F'|'K'
  		"options": {}
  	}
  }
  ```

  As you can see on this file you can also change the API_Key, if you want to use default API_Key put `0000` in this field

## Future features

- Average temperature for each day
- Some frills such as wind speed etc...

## Credit
Open Weather API : [Go](https://openweathermap.org/api)
