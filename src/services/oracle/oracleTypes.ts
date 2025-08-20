// Oracle data types and interfaces

export interface OracleDataPoint {
  source: string;
  dataType: string;
  value: any;
  timestamp: number;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface AggregatedOracleData {
  dataType: string;
  sources: string[];
  aggregatedValue: any;
  confidence: number;
  timestamp: number;
  dataPoints: OracleDataPoint[];
  consensusMethod: string;
}

export interface OracleSource {
  name: string;
  type: 'price_feed' | 'weather' | 'space' | 'crypto' | 'iot' | 'financial';
  endpoint?: string;
  apiKey?: string;
  rateLimit?: number; // requests per minute
  enabled: boolean;
  reliability: number; // 0-1 score
}

export interface PriceFeedData {
  symbol: string;
  price: number;
  currency: string;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
}

export interface WeatherData {
  location: string;
  temperature: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  condition: string;
  coordinates?: {
    lat: number;
    lon: number;
  };
}

export interface SpaceData {
  dataType: 'asteroid' | 'earth_imagery' | 'weather_satellite' | 'mars_rover';
  data: any;
  mission?: string;
  instrument?: string;
  date: string;
}

export interface ConsensusResult {
  value: any;
  confidence: number;
  participatingSources: string[];
  method: 'majority' | 'weighted_average' | 'median' | 'ai_consensus';
  outliers?: string[];
}

export enum OracleDataType {
  PRICE_FEED = 'price_feed',
  WEATHER = 'weather',
  SPACE = 'space',
  CRYPTO_METRICS = 'crypto_metrics',
  IOT_SENSOR = 'iot_sensor',
  FINANCIAL = 'financial'
}

export enum ConsensusMethod {
  MAJORITY_VOTE = 'majority',
  WEIGHTED_AVERAGE = 'weighted_average',
  MEDIAN = 'median',
  AI_CONSENSUS = 'ai_consensus'
}

export interface OracleConfig {
  sources: OracleSource[];
  consensusThreshold: number; // minimum sources needed for consensus
  maxDeviationPercent: number; // maximum allowed deviation for outlier detection
  cacheTimeout: number; // cache timeout in milliseconds
  retryAttempts: number;
  retryDelay: number; // delay between retries in milliseconds
}

export interface OracleResponse {
  success: boolean;
  data?: OracleDataPoint;
  error?: string;
  source: string;
  timestamp: number;
  responseTime: number;
}