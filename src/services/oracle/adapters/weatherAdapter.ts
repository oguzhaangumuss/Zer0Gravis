import fetch from 'node-fetch';
import { logger } from '../../../utils/logger';
import { OracleDataPoint, OracleResponse, WeatherData } from '../oracleTypes';

export class WeatherAdapter {
  private readonly baseUrl = 'http://api.openweathermap.org/data/2.5';
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    // For development, we'll work without API key and simulate data
    // In production, this would require a real OpenWeatherMap API key
    this.apiKey = apiKey || 'demo_key';
    logger.info('Weather adapter initialized');
  }

  async getCurrentWeather(city: string): Promise<OracleResponse> {
    const startTime = Date.now();

    try {
      // For development, simulate weather data
      // In production with real API key:
      /*
      const url = `${this.baseUrl}/weather?q=${city}&appid=${this.apiKey}&units=metric`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }
      
      const data = await response.json();
      */

      // Simulated weather data for development
      const simulatedData = await this.simulateWeatherData(city);

      const oracleDataPoint: OracleDataPoint = {
        source: 'openweathermap',
        dataType: 'weather',
        value: simulatedData,
        timestamp: Date.now(),
        confidence: 0.85, // Weather data has good confidence
        metadata: {
          city: city,
          provider: 'OpenWeatherMap',
          units: 'metric'
        }
      };

      logger.info('Weather data retrieved', {
        city,
        temperature: simulatedData.temperature,
        condition: simulatedData.condition
      });

      return {
        success: true,
        data: oracleDataPoint,
        source: 'openweathermap',
        timestamp: Date.now(),
        responseTime: Date.now() - startTime
      };

    } catch (error: any) {
      logger.error('Weather adapter error', {
        city,
        error: error.message,
        responseTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message,
        source: 'openweathermap',
        timestamp: Date.now(),
        responseTime: Date.now() - startTime
      };
    }
  }

  private async simulateWeatherData(city: string): Promise<WeatherData> {
    // Simulate realistic weather data for different cities
    const baseTemperatures: Record<string, number> = {
      'London': 15,
      'New York': 20,
      'Tokyo': 25,
      'Sydney': 22,
      'Istanbul': 18,
      'Berlin': 12,
      'Miami': 28,
      'Moscow': 5
    };

    const baseTemp = baseTemperatures[city] || 20;
    
    // Add random variation
    const temperature = baseTemp + (Math.random() - 0.5) * 10;
    
    const conditions = [
      'Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 
      'Heavy Rain', 'Snow', 'Fog', 'Sunny'
    ];
    
    const condition = conditions[Math.floor(Math.random() * conditions.length)];

    // Generate coordinates (simplified)
    const coordinates = this.getCityCoordinates(city);

    return {
      location: city,
      temperature: Math.round(temperature * 10) / 10,
      humidity: Math.floor(Math.random() * 40) + 40, // 40-80%
      pressure: Math.floor(Math.random() * 100) + 1000, // 1000-1100 hPa
      windSpeed: Math.round((Math.random() * 20) * 10) / 10, // 0-20 m/s
      condition: condition,
      coordinates: coordinates
    };
  }

  private getCityCoordinates(city: string): { lat: number; lon: number } {
    // Simplified city coordinates
    const coordinates: Record<string, { lat: number; lon: number }> = {
      'London': { lat: 51.5074, lon: -0.1278 },
      'New York': { lat: 40.7128, lon: -74.0060 },
      'Tokyo': { lat: 35.6762, lon: 139.6503 },
      'Sydney': { lat: -33.8688, lon: 151.2093 },
      'Istanbul': { lat: 41.0082, lon: 28.9784 },
      'Berlin': { lat: 52.5200, lon: 13.4050 },
      'Miami': { lat: 25.7617, lon: -80.1918 },
      'Moscow': { lat: 55.7558, lon: 37.6173 }
    };

    return coordinates[city] || { lat: 0, lon: 0 };
  }

  async getWeatherForecast(city: string, days: number = 5): Promise<OracleResponse> {
    const startTime = Date.now();

    try {
      // Simulate forecast data
      const forecastData = [];
      
      for (let i = 0; i < days; i++) {
        const weatherData = await this.simulateWeatherData(city);
        forecastData.push({
          ...weatherData,
          date: new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        });
      }

      const oracleDataPoint: OracleDataPoint = {
        source: 'openweathermap',
        dataType: 'weather_forecast',
        value: {
          city: city,
          forecast: forecastData,
          days: days
        },
        timestamp: Date.now(),
        confidence: 0.80, // Forecast has lower confidence than current weather
        metadata: {
          city: city,
          forecastDays: days,
          provider: 'OpenWeatherMap'
        }
      };

      logger.info('Weather forecast retrieved', {
        city,
        days,
        forecastLength: forecastData.length
      });

      return {
        success: true,
        data: oracleDataPoint,
        source: 'openweathermap',
        timestamp: Date.now(),
        responseTime: Date.now() - startTime
      };

    } catch (error: any) {
      logger.error('Weather forecast error', {
        city,
        days,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        source: 'openweathermap',
        timestamp: Date.now(),
        responseTime: Date.now() - startTime
      };
    }
  }

  async getMultipleCitiesWeather(cities: string[]): Promise<OracleResponse[]> {
    const promises = cities.map(city => this.getCurrentWeather(city));
    return await Promise.all(promises);
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple city request
      const result = await this.getCurrentWeather('London');
      return result.success;
    } catch (error: any) {
      logger.error('Weather adapter connection test failed', { error: error.message });
      return false;
    }
  }

  async getProviderInfo(): Promise<any> {
    return {
      provider: 'openweathermap',
      baseUrl: this.baseUrl,
      hasApiKey: this.apiKey !== 'demo_key',
      supportedCities: [
        'London', 'New York', 'Tokyo', 'Sydney', 
        'Istanbul', 'Berlin', 'Miami', 'Moscow'
      ],
      dataTypes: ['current_weather', 'forecast'],
      status: 'connected'
    };
  }
}