from typing import Any, Dict, Optional

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network, NetworkError

DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []


DEFAULT_FORECAST_DAYS = 1
CURRENT_WEATHER_VARIABLES = [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature",
    "weather_code", "wind_speed_10m", "wind_direction_10m",
]
HOURLY_FORECAST_VARIABLES = [
    *CURRENT_WEATHER_VARIABLES,
    "precipitation_probability",
    "precipitation",
]
DAILY_FORECAST_VARIABLES = [
    "weather_code", "temperature_2m_min", "temperature_2m_max",
    "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max",
]


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


def _normalize_date_range(
    start_date: Optional[str], end_date: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    """Ensure Open-Meteo always receives both interval boundaries."""
    supplied_boundary = start_date or end_date
    return start_date or supplied_boundary, end_date or supplied_boundary


def _format_current_conditions(current: Dict[str, Any], location: str) -> Dict[str, Any]:
    """Format the current timestamp independently from forecast hours."""
    temperature = round(current["temperature_2m"])
    feels_like = round(current["apparent_temperature"])
    wind_speed = round(current["wind_speed_10m"])

    return {
        "location": location,
        "description": _get_weather_description(current["weather_code"]),
        "temperatureC": str(temperature),
        "temperatureF": _celsius_to_fahrenheit(temperature),
        "feelsLikeC": str(feels_like),
        "feelsLikeF": _celsius_to_fahrenheit(feels_like),
        "humidity": str(current["relative_humidity_2m"]),
        "windKmph": str(wind_speed),
        "windMph": str(round(wind_speed * 0.621371)),
        "windDirection": _degrees_to_compass(current["wind_direction_10m"]),
        "observationTime": current["time"],
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

    def get_weather(
        self,
        location: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return current conditions and today's forecast, or a requested interval."""
        if not location or not location.strip():
            return {"success": False, "error": "Location is required."}

        try:
            geocoding = self._geocode(location.strip())
            if not geocoding:
                return {"success": False, "error": "Location not found."}

            weather = self._fetch_weather(
                geocoding["latitude"],
                geocoding["longitude"],
                start_date,
                end_date,
            )
            daily = weather.get("daily", {})
            hourly = weather.get("hourly", {})
            if not daily.get("time") or not hourly.get("time"):
                return {"success": False, "error": "No forecast data available for this location."}

            data = {
                "location": geocoding["display_name"],
                "timezone": weather.get("timezone"),
                "utcOffsetSeconds": weather.get("utc_offset_seconds"),
                "dailyUnits": weather.get("daily_units"),
                "hourlyUnits": weather.get("hourly_units"),
                "daily": {
                    **daily,
                    "description": [
                        _get_weather_description(code) for code in daily["weather_code"]
                    ],
                },
                "hourly": {
                    **hourly,
                    "description": [
                        _get_weather_description(code) for code in hourly["weather_code"]
                    ],
                },
            }
            if weather.get("current"):
                data["current"] = _format_current_conditions(
                    weather["current"], geocoding["display_name"]
                )

            return {"success": True, "data": data}
        except Exception as error:
            result = {"success": False, "error": f"Failed to fetch weather: {error}"}
            if isinstance(error, NetworkError):
                result["statusCode"] = error.response.get("status_code")
            return result

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

        normalized_start_date, normalized_end_date = _normalize_date_range(
            start_date, end_date
        )
        query_params_object = {
            "latitude": str(latitude),
            "longitude": str(longitude),
            "temperature_unit": "celsius",
            "wind_speed_unit": "kmh",
            "timezone": "auto",
        }

        query_params_object["hourly"] = ",".join(HOURLY_FORECAST_VARIABLES)
        query_params_object["daily"] = ",".join(DAILY_FORECAST_VARIABLES)
        if normalized_start_date and normalized_end_date:
            query_params_object["start_date"] = normalized_start_date
            query_params_object["end_date"] = normalized_end_date
        else:
            query_params_object["forecast_days"] = str(DEFAULT_FORECAST_DAYS)
            query_params_object["current"] = ",".join(CURRENT_WEATHER_VARIABLES)

        query_params = urlencode(query_params_object)

        response = self.weather_network.request(
            {
                "url": f"/v1/forecast?{query_params}",
                "method": "GET",
            }
        )

        return response.get("data", {})
