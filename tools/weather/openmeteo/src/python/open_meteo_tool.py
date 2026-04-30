from typing import Any, Dict, Optional

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network, NetworkError

DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []


WMO_CODE_DESCRIPTIONS: Dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}

WIND_DIRECTIONS = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
]


def _degrees_to_compass(degrees: float) -> str:
    index = round(degrees / 22.5) % 16
    return WIND_DIRECTIONS[index]


def _celsius_to_fahrenheit(celsius: float) -> str:
    return str(round(celsius * 9 / 5 + 32))


def _get_weather_description(code: int) -> str:
    return WMO_CODE_DESCRIPTIONS.get(code, "Unknown")


def _map_hourly_to_current(hourly: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    times = hourly.get("time")
    if not isinstance(times, list) or not times:
        return None

    time_values = [str(time) for time in times]
    index = 0

    def value_at(key: str) -> Any:
        values = hourly.get(key)
        if not isinstance(values, list) or index >= len(values):
            return None
        return values[index]

    temperature = value_at("temperature_2m")
    humidity = value_at("relative_humidity_2m")
    apparent_temperature = value_at("apparent_temperature")
    weather_code = value_at("weather_code")
    wind_speed = value_at("wind_speed_10m")
    wind_direction = value_at("wind_direction_10m")

    if (
        temperature is None
        or humidity is None
        or apparent_temperature is None
        or weather_code is None
        or wind_speed is None
        or wind_direction is None
        or index >= len(time_values)
    ):
        return None

    return {
        "temperature_2m": temperature,
        "relative_humidity_2m": humidity,
        "apparent_temperature": apparent_temperature,
        "weather_code": weather_code,
        "wind_speed_10m": wind_speed,
        "wind_direction_10m": wind_direction,
        "time": time_values[index],
    }


class OpenMeteoTool(BaseTool):
    TOOLKIT = "weather"

    def __init__(self) -> None:
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)
        self.geocoding_network = Network(
            {"base_url": "https://geocoding-api.open-meteo.com"}
        )
        self.weather_network = Network({"base_url": "https://api.open-meteo.com"})

    @property
    def tool_name(self) -> str:
        return "openmeteo"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config.get("description", "")

    def get_current_conditions(
        self,
        location: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not location or not location.strip():
            return {"success": False, "error": "Location is required."}

        try:
            geocoding_result = self._geocode(location.strip())
            if not geocoding_result:
                return {"success": False, "error": "Location not found."}

            weather = self._fetch_weather(
                geocoding_result["latitude"],
                geocoding_result["longitude"],
                start_date,
                end_date,
            )

            current = weather.get("current")
            if not current:
                return {
                    "success": False,
                    "error": "No weather data available for this location.",
                }

            temp_c = round(current.get("temperature_2m", 0))
            feels_like_c = round(current.get("apparent_temperature", 0))
            wind_kmph = round(current.get("wind_speed_10m", 0))

            return {
                "success": True,
                "data": {
                    "location": geocoding_result["display_name"],
                    "description": _get_weather_description(
                        current.get("weather_code", 0)
                    ),
                    "temperatureC": str(temp_c),
                    "temperatureF": _celsius_to_fahrenheit(temp_c),
                    "feelsLikeC": str(feels_like_c),
                    "feelsLikeF": _celsius_to_fahrenheit(feels_like_c),
                    "humidity": str(current.get("relative_humidity_2m", "")),
                    "windKmph": str(wind_kmph),
                    "windMph": str(round(wind_kmph * 0.621371)),
                    "windDirection": _degrees_to_compass(
                        current.get("wind_direction_10m", 0)
                    ),
                    "observationTime": current.get("time", ""),
                },
            }
        except Exception as error:
            status_code = None
            if isinstance(error, NetworkError):
                status_code = error.response.get("status_code")

            return {
                "success": False,
                "error": f"Failed to fetch weather: {str(error)}",
                "statusCode": status_code,
            }

    def _geocode(self, location: str) -> Optional[Dict[str, Any]]:
        from urllib.parse import urlencode

        query_params = urlencode(
            {
                "name": location,
                "count": "1",
                "language": "en",
                "format": "json",
            }
        )

        response = self.geocoding_network.request(
            {
                "url": f"/v1/search?{query_params}",
                "method": "GET",
            }
        )

        results = response.get("data", {}).get("results", [])
        if not results:
            return None

        result = results[0]
        parts = [
            result.get("name"),
            result.get("admin1"),
            result.get("country"),
        ]
        parts = [p for p in parts if p]

        return {
            "latitude": result.get("latitude"),
            "longitude": result.get("longitude"),
            "display_name": ", ".join(parts) if parts else location,
        }

    def _fetch_weather(
        self,
        latitude: float,
        longitude: float,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        from urllib.parse import urlencode

        query_params_object = {
            "latitude": str(latitude),
            "longitude": str(longitude),
            "temperature_unit": "celsius",
            "wind_speed_unit": "kmh",
            "timezone": "auto",
        }

        if start_date or end_date:
            query_params_object["hourly"] = (
                "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m"
            )
            if start_date:
                query_params_object["start_date"] = start_date
            if end_date:
                query_params_object["end_date"] = end_date
        else:
            query_params_object["current"] = (
                "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m"
            )

        query_params = urlencode(query_params_object)

        response = self.weather_network.request(
            {
                "url": f"/v1/forecast?{query_params}",
                "method": "GET",
            }
        )

        weather_data = response.get("data", {})
        if not weather_data.get("current") and isinstance(weather_data.get("hourly"), dict):
            current = _map_hourly_to_current(weather_data.get("hourly", {}))
            if current:
                weather_data["current"] = current

        return weather_data
