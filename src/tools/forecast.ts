/**
 * https://www.weatherbit.io/api/weather-forecast-16-day
 */

import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { FunctionDefinition } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'get_weather_forecast',
  description: 'Get 7 day forecast in 1 day intervals in a given city',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description:
          'The city and state(optional) in English, e.g. Raleigh,North Carolina',
      },
    },
    required: ['city'],
  },
};

export async function execute(arg: string): Promise<string> {
  try {
    const { city } = JSON.parse(arg);
    const apiKey = env.WEATHER_BIT_API_KEY;
    const url =
      `https://api.weatherbit.io/v2.0/forecast/daily?key=${apiKey}&city=${
        encodeURIComponent(city)
      }`;
    const res = await fetch(url);
    if (!res.ok) {
      return `HTTP error! Status: ${res.status}`;
    }
    const weatherRes: WeatherApiResponse = await res.json();
    if (!weatherRes.data?.length) {
      return 'No weather data found';
    }

    return `City: ${weatherRes.city_name}\nToday: ${getCurrentDate()}\n\n` +
      weatherRes.data.map((day) =>
        `[${day.valid_date}]
Weather: ${day.weather.description}
Average Temperature: ${day.temp}
Minimum Temperature: ${day.min_temp}
Maximum Temperature: ${day.max_temp}
Humidity: ${day.rh}%
Wind: ${day.wind_spd} m/s
Visibility: ${day.vis} km
Probability of Precipitation: ${day.pop}%`.trim()
      ).join('\n\n');
  } catch (err) {
    return `Failed to fetch weather data: ${(err as Error).message}`;
  }
}

export async function getTodaysForecast(city: string): Promise<string> {
  try {
    const apiKey = env.WEATHER_BIT_API_KEY;
    const url =
      `https://api.weatherbit.io/v2.0/forecast/daily?key=${apiKey}&city=${city}`;
    const res = await fetch(url);
    if (!res.ok) {
      return `HTTP error! Status: ${res.status}`;
    }
    const weatherRes: WeatherApiResponse = await res.json();
    if (!weatherRes.data?.length) {
      return 'No weather data found';
    }

    const day = weatherRes.data[0];

    return `Average Temperature: ${day.temp}
Minimum Temperature: ${day.min_temp}
Maximum Temperature: ${day.max_temp}`.trim();
  } catch (err) {
    return `Failed to fetch weather data: ${(err as Error).message}`;
  }
}

function getCurrentDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

interface WeatherData {
  valid_date: string; // Local date the forecast is valid for (YYYY-MM-DD)
  ts: number; // Forecast period start unix timestamp (UTC)
  wind_gust_spd: number; // Wind gust speed (m/s)
  wind_spd: number; // Wind speed (m/s)
  wind_dir: number; // Wind direction (degrees)
  wind_cdir: string; // Abbreviated wind direction
  wind_cdir_full: string; // Verbal wind direction
  temp: number; // Average Temperature (Celsius)
  max_temp: number; // Maximum Temperature (Celsius)
  min_temp: number; // Minimum Temperature (Celsius)
  high_temp: number; // High Temperature "Day-time High" (Celsius)
  low_temp: number; // Low Temperature "Night-time Low" (Celsius)
  app_max_temp: number; // Apparent/"Feels Like" temperature at max_temp time (Celsius)
  app_min_temp: number; // Apparent/"Feels Like" temperature at min_temp time (Celsius)
  pop: number; // Probability of Precipitation (%)
  precip: number; // Accumulated liquid equivalent precipitation (mm)
  snow: number; // Accumulated snowfall (mm)
  snow_depth: number; // Snow Depth (mm)
  pres: number; // Average pressure (mb)
  slp: number; // Average sea level pressure (mb)
  dewpt: number; // Average dew point (Celsius)
  rh: number; // Average relative humidity (%)
  weather: {
    icon: string; // Weather icon code
    code: string; // Weather code
    description: string; // Text weather description
  };
  clouds_low: number; // Low-level cloud coverage (%)
  clouds_mid: number; // Mid-level cloud coverage (%)
  clouds_hi: number; // High-level cloud coverage (%)
  clouds: number; // Average total cloud coverage (%)
  vis: number; // Visibility (KM)
  max_dhi: number; // [DEPRECATED] Maximum direct component of solar radiation (W/m^2)
  uv: number; // Maximum UV Index (0-11+)
  moon_phase: number; // Moon phase illumination fraction (0-1)
  moon_phase_lunation: number; // Moon lunation fraction (0 = New moon, 0.50 = Full Moon, 0.75 = Last quarter moon)
  moonrise_ts: number; // Moonrise time unix timestamp (UTC)
  moonset_ts: number; // Moonset time unix timestamp (UTC)
  sunrise_ts: number; // Sunrise time unix timestamp (UTC)
  sunset_ts: number; // Sunset time unix timestamp (UTC)
}

interface WeatherApiResponse {
  data: WeatherData[]; // Array of weather data for each day
  city_name: string; // Nearest city name
  lon: string; // Longitude (Degrees)
  timezone: string; // Local IANA Timezone
  lat: string; // Latitude (Degrees)
  country_code: string; // Country abbreviation
  state_code: string; // State abbreviation/code
}
