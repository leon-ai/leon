#!/usr/bin/env python
# -*- coding:utf-8 -*-

import functools
from datetime import datetime

from pyowm import OWM

import utils


# Decorators

def load_config(func):
    @functools.wraps(func)
    def wrapper_load_config(string, entities):
        payload = dict()
        payload["string"] = string
        payload["entities"] = entities

        api_key = utils.config("api_key")
        pro = utils.config("pro")
        payload["temperature_units"] = utils.config("temperature_units")

        if (payload["temperature_units"] != "celsius") and (payload["temperature_units"] != "fahrenheit"):
            return utils.output("end", "invalid_temperature_units", utils.translate("invalid_temperature_units"))

        if pro:
            payload["owm"] = OWM(api_key, subscription_type="pro")
        else:
            payload["owm"] = OWM(api_key)

        return func(payload)
    return wrapper_load_config

def acquire_weather(func):
    @functools.wraps(func)
    def wrapper_acquire_weather(payload):
        for item in payload["entities"]:
            if item["entity"] == "city":
                utils.output("inter", "acquiring", utils.translate("acquiring"))

                payload["city"] = item["sourceText"]
                payload["observation"] = payload["owm"].weather_at_place(payload["city"])
                payload["wtr"] = payload["observation"].get_weather()

                return func(payload)
        return utils.output("end", "request_error", utils.translate("request_error"))

    return wrapper_acquire_weather


# Methods

@load_config
@acquire_weather
def current_weather(payload):
    """
    Get the current weather.
    """

    detailed_status = payload["wtr"].get_detailed_status()
    temperatures = payload["wtr"].get_temperature(payload["temperature_units"])   # {"temp_max": 10.5, "temp": 9.7, "temp_min": 9.0}
    humidity = payload["wtr"].get_humidity()
    wind = payload["wtr"].get_wind()   # {"speed": 4.6, "deg": 330}

    return utils.output(
        "end",
        "current_weather",
        utils.translate(
            "current_weather",
            {
                "detailed_status": detailed_status.capitalize(),
                "city": payload["city"],
                "temperature": temperatures["temp"],
                "temperature_units": payload["temperature_units"].capitalize(),
                "humidity": humidity
            }
        )
    )

@load_config
@acquire_weather
def sunrise(payload):
    """
    Get when the sun rises.
    """

    dt = payload["wtr"].get_sunrise_time("date")

    return utils.output("end", "sunrise", utils.translate("sunrise", {"time": dt.strftime("%H:%M:%S"), "city": payload["city"]}))

@load_config
@acquire_weather
def sunset(payload):
    """
    Get when the sun sets.
    """

    dt = payload["wtr"].get_sunset_time("date")

    return utils.output("end", "sunset", utils.translate("sunset", {"time": dt.strftime("%H:%M:%S"), "city": payload["city"]}))
