# Weather Package

The weather package contains modules which include getting the latest weather forecast.

## Modules

### OpenWeatherMap

#### Requirements
- tzlocal
- PyOWM

#### Usage

1. Register a new account on [OpenWeatherMap Sign Up](https://openweathermap.org/sign_up) unless you already have one.
2. Generate a new API key on [OpenWeatherMap API keys](https://home.openweathermap.org/api_keys).
3. Duplicate the file `packages/weather/config/config.sample.json` and rename it `config.json`.
4. Copy the API key in `packages/weather/config/config.json` and set the other options to your liking.
5. This package uses PyOWM. To install it: from inside leon directory `cd bridges/python`
6. `pipenv install tzlocal pyowm`
7. Done!

```
(en-US)
- "What's the weather like in Milan?"
- "When is the sun going to set in Rome?"
- "Is it windy in Chicago?"

(it-IT)
- "Che tempo fa a Milano?"
- "Quando tramonta il sole a Roma?"
...
```

#### Options
- `pro`: Set this to `true` if you have a premium subscription.
- `temperature_units`: Choose which temperature scale to use. ["celsius", "fahrenheit"]
- `wind_speed_units`: Choose which units to use for the wind speed. ["meters per second", "miles per hour"] More units coming soon.

#### Links

- [OpenWeatherMap API](https://developers.google.com/youtube/v3/getting-started)
- [PyOWM GitHub](https://github.com/csparpa/pyowm)
- [PyOWM Docs](https://pyowm.readthedocs.io/en/latest/)

#### TODO
- Implement some sort of caching mechanism. PyOWM does support caching, but it's a bit messy. It might be easier to implement it from scratch, perhaps with some sort of db like TinyDb which is already supported by leon.
- Implement `pro` functionality for OWM.
- Add more weather services and related (UV, pollution, sky events, etc.).
