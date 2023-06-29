import os
from typing import Union, TypedDict


class TimeZone(TypedDict):
    country_code: str
    id: str
    coordinated_universal_time_offset: float
    daylight_saving_time_offset: float


# Extracted from: <https://download.geonames.org/export/dump/timeZones.txt>
time_zones_path = os.path.join(os.path.dirname(__file__), 'time_zones.txt')

time_zones: list[list[str]] = []
with open(time_zones_path, 'r') as file:
    lines = file.read().splitlines()
    for line in lines:
        time_zones.append(line.rstrip().split('\t'))


def get_time_zone_data(time_zone_id: str) -> Union[TimeZone, None]:
    time_zone_data: Union[TimeZone, None] = None
    for time_zone in time_zones:
        if time_zone[1] == time_zone_id:
            time_zone_data = {
                'country_code': time_zone[0],
                'id': time_zone[1],
                'coordinated_universal_time_offset': float(time_zone[2]),
                'daylight_saving_time_offset': float(time_zone[3])
            }
            break
    return time_zone_data
