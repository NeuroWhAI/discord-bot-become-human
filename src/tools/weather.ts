/**
 * https://www.weatherbit.io/api/weather-current
 */

import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { FunctionDefinition } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'get_current_weather',
  description: 'Get the current weather in a given city',
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
      `https://api.weatherbit.io/v2.0/current?key=${apiKey}&city=${city}`;
    const res = await fetch(url);
    if (!res.ok) {
      return `HTTP error! Status: ${res.status}`;
    }
    const weatherRes: WeatherApiResponse = await res.json();
    const data = weatherRes.data[0];
    return `City: ${data.city_name}
Weather: ${data.weather.description}
Temperature: ${data.temp}
Feels Like: ${data.app_temp}
Humidity: ${data.rh}%
Wind: ${data.wind_spd} m/s
Visibility: ${data.vis} km`.trim();
  } catch (err) {
    return `Failed to fetch weather data: ${(err as Error).message}`;
  }
}

interface WeatherData {
  wind_cdir: string; // Abbreviated wind direction
  rh: number; // Relative humidity (%)
  pod: string; // Part of the day (d = day / n = night)
  lon: number; // Longitude (Degrees)
  pres: number; // Pressure (mb)
  timezone: string; // Local IANA Timezone
  ob_time: string; // Last observation time (YYYY-MM-DD HH:MM)
  country_code: string; // Country abbreviation
  clouds: number; // Cloud coverage (%)
  vis: number; // Visibility (default KM)
  wind_spd: number; // Wind speed (Default m/s)
  gust: number; // Wind gust speed (Default m/s)
  wind_cdir_full: string; // Verbal wind direction
  app_temp: number; // Apparent/"Feels Like" temperature (default Celsius)
  state_code: string; // State abbreviation/code
  ts: number; // Last observation time (Unix timestamp)
  h_angle: number; // [DEPRECATED] Solar hour angle (degrees)
  dewpt: number; // Dew point (default Celsius)
  weather: {
    icon: string; // Weather icon code
    code: number; // Weather code
    description: string; // Text weather description
  };
  uv: number; // UV Index (0-11+)
  aqi: number; // Air Quality Index [US - EPA standard 0 - +500]
  station: string; // [DEPRECATED] Nearest reporting station ID
  sources: string[]; // List of data sources used in response
  wind_dir: number; // Wind direction (degrees)
  elev_angle: number; // Solar elevation angle (degrees)
  datetime: string; // [DEPRECATED] Current cycle hour (YYYY-MM-DD:HH)
  precip: number; // Liquid equivalent precipitation rate (default mm/hr)
  ghi: number; // Global horizontal solar irradiance (W/m^2) [Clear Sky]
  dni: number; // Direct normal solar irradiance (W/m^2) [Clear Sky]
  dhi: number; // Diffuse horizontal solar irradiance (W/m^2) [Clear Sky]
  solar_rad: number; // Estimated Solar Radiation (W/m^2)
  city_name: string; // City name
  sunrise: string; // Sunrise time UTC (HH:MM)
  sunset: string; // Sunset time UTC (HH:MM)
  temp: number; // Temperature (default Celsius)
  lat: number; // Latitude (Degrees)
  slp: number; // Sea level pressure (mb)
}

interface WeatherApiResponse {
  data: WeatherData[];
  count: number;
}
