import { logger } from '../../utils/logger';
import { ChainlinkAdapter } from './adapters/chainlinkAdapter';
import { WeatherAdapter } from './adapters/weatherAdapter';
import { NASAAdapter } from './adapters/nasaAdapter';
import { ZeroGChainService } from '../chain/zeroGChainService';
import { 
  OracleDataPoint, 
  OracleResponse, 
  AggregatedOracleData, 
  ConsensusResult, 
  OracleDataType,
  ConsensusMethod 
} from './oracleTypes';

export interface CollectDataRequest {
  dataType: OracleDataType;
  sources: string[]; // which oracle sources to use
  parameters?: Record<string, any>; // specific parameters for the data request
  consensusMethod?: ConsensusMethod;
}

export interface CollectDataResponse {
  success: boolean;
  aggregatedData?: AggregatedOracleData;
  error?: string;
  executionTime: number;
  sourcesUsed: string[];
  consensusAchieved: boolean;
}

export class OracleAggregationService {
  private chainlinkAdapter: ChainlinkAdapter;
  private weatherAdapter: WeatherAdapter;
  private nasaAdapter: NASAAdapter;
  private chainService: ZeroGChainService;

  // Oracle source mapping
  private readonly oracleSources = {
    chainlink: 'chainlinkAdapter',
    weather: 'weatherAdapter', 
    nasa: 'nasaAdapter'
  };

  constructor() {
    this.chainlinkAdapter = new ChainlinkAdapter();
    this.weatherAdapter = new WeatherAdapter();
    this.nasaAdapter = new NASAAdapter();
    this.chainService = new ZeroGChainService();

    logger.info('Oracle Aggregation Service initialized');
  }

  async collectData(request: CollectDataRequest): Promise<CollectDataResponse> {
    const startTime = Date.now();
    logger.info('Starting oracle data collection', { 
      dataType: request.dataType,
      sources: request.sources,
      parameters: request.parameters
    });

    try {
      // Collect data from specified sources
      const responses = await this.collectFromSources(request);
      
      // Filter successful responses
      const successfulResponses = responses.filter(r => r.success);
      
      if (successfulResponses.length === 0) {
        return {
          success: false,
          error: 'No oracle sources returned valid data',
          executionTime: Date.now() - startTime,
          sourcesUsed: request.sources,
          consensusAchieved: false
        };
      }

      // Calculate consensus
      const consensusResult = await this.calculateConsensus(
        successfulResponses,
        request.consensusMethod || ConsensusMethod.WEIGHTED_AVERAGE
      );

      // Create aggregated data
      const aggregatedData: AggregatedOracleData = {
        dataType: request.dataType,
        sources: successfulResponses.map(r => r.source),
        aggregatedValue: consensusResult.value,
        confidence: consensusResult.confidence,
        timestamp: Date.now(),
        dataPoints: successfulResponses.map(r => r.data!),
        consensusMethod: request.consensusMethod || ConsensusMethod.WEIGHTED_AVERAGE
      };

      // Submit to 0G Chain for persistence
      try {
        const chainResult = await this.chainService.submitOracleData({
          source: 'aggregated',
          dataType: request.dataType,
          value: aggregatedData,
          timestamp: Date.now()
        });

        logger.info('Oracle data submitted to 0G Chain', {
          dataHash: chainResult.dataHash,
          transactionHash: chainResult.transactionHash
        });

      } catch (chainError: any) {
        logger.warn('Failed to submit to chain, but aggregation successful', {
          error: chainError.message
        });
      }

      const executionTime = Date.now() - startTime;
      
      logger.info('Oracle data collection completed', {
        dataType: request.dataType,
        sourcesUsed: successfulResponses.length,
        consensus: consensusResult.confidence,
        executionTime
      });

      return {
        success: true,
        aggregatedData: aggregatedData,
        executionTime: executionTime,
        sourcesUsed: successfulResponses.map(r => r.source),
        consensusAchieved: consensusResult.confidence > 0.5
      };

    } catch (error: any) {
      logger.error('Oracle data collection failed', {
        error: error.message,
        request,
        executionTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
        sourcesUsed: request.sources,
        consensusAchieved: false
      };
    }
  }

  private async collectFromSources(request: CollectDataRequest): Promise<OracleResponse[]> {
    const promises: Promise<OracleResponse>[] = [];

    for (const source of request.sources) {
      switch (source) {
        case 'chainlink':
          if (request.dataType === OracleDataType.PRICE_FEED && request.parameters?.symbol) {
            promises.push(this.chainlinkAdapter.getPriceFeed(request.parameters.symbol));
          }
          break;

        case 'weather':
          if (request.dataType === OracleDataType.WEATHER && request.parameters?.city) {
            promises.push(this.weatherAdapter.getCurrentWeather(request.parameters.city));
          }
          break;

        case 'nasa':
          if (request.dataType === OracleDataType.SPACE) {
            if (request.parameters?.spaceDataType === 'asteroid') {
              promises.push(this.nasaAdapter.getAsteroidData(request.parameters?.date));
            } else if (request.parameters?.spaceDataType === 'earth_imagery') {
              promises.push(this.nasaAdapter.getEarthImagery(
                request.parameters.lat,
                request.parameters.lon,
                request.parameters.date
              ));
            } else if (request.parameters?.spaceDataType === 'mars_weather') {
              promises.push(this.nasaAdapter.getMarsWeatherData());
            } else {
              promises.push(this.nasaAdapter.getApod());
            }
          }
          break;

        default:
          logger.warn('Unknown oracle source requested', { source });
      }
    }

    // Execute all oracle calls in parallel
    const responses = await Promise.allSettled(promises);
    
    return responses.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          error: result.reason?.message || 'Unknown error',
          source: request.sources[index],
          timestamp: Date.now(),
          responseTime: 0
        };
      }
    });
  }

  private async calculateConsensus(
    responses: OracleResponse[],
    method: ConsensusMethod
  ): Promise<ConsensusResult> {
    
    logger.info('Calculating consensus', {
      method,
      responseCount: responses.length
    });

    const dataPoints = responses.map(r => r.data!);
    let consensusValue: any;
    let confidence: number;

    switch (method) {
      case ConsensusMethod.MAJORITY_VOTE:
        const result = this.majorityVoteConsensus(dataPoints);
        consensusValue = result.value;
        confidence = result.confidence;
        break;

      case ConsensusMethod.WEIGHTED_AVERAGE:
        const weightedResult = this.weightedAverageConsensus(dataPoints);
        consensusValue = weightedResult.value;
        confidence = weightedResult.confidence;
        break;

      case ConsensusMethod.MEDIAN:
        const medianResult = this.medianConsensus(dataPoints);
        consensusValue = medianResult.value;
        confidence = medianResult.confidence;
        break;

      case ConsensusMethod.AI_CONSENSUS:
        // For now, fallback to weighted average
        // In future, this could use 0G Compute for AI-based consensus
        const aiResult = this.weightedAverageConsensus(dataPoints);
        consensusValue = aiResult.value;
        confidence = aiResult.confidence;
        break;

      default:
        throw new Error(`Unsupported consensus method: ${method}`);
    }

    return {
      value: consensusValue,
      confidence: confidence,
      participatingSources: responses.map(r => r.source),
      method: method,
      outliers: [] // TODO: Implement outlier detection
    };
  }

  private majorityVoteConsensus(dataPoints: OracleDataPoint[]): { value: any; confidence: number } {
    if (dataPoints.length === 0) {
      return { value: null, confidence: 0 };
    }

    // For price feeds, use the most common price range
    if (dataPoints[0].dataType === 'price_feed') {
      const prices = dataPoints.map(dp => dp.value.price);
      const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      
      // Count how many prices are within 5% of average
      const tolerance = avgPrice * 0.05;
      const consensusPrices = prices.filter(price => 
        Math.abs(price - avgPrice) <= tolerance
      );

      const confidence = consensusPrices.length / prices.length;
      
      return {
        value: {
          ...dataPoints[0].value,
          price: avgPrice
        },
        confidence: confidence
      };
    }

    // For other data types, return the first value with moderate confidence
    return {
      value: dataPoints[0].value,
      confidence: 1.0 / dataPoints.length
    };
  }

  private weightedAverageConsensus(dataPoints: OracleDataPoint[]): { value: any; confidence: number } {
    if (dataPoints.length === 0) {
      return { value: null, confidence: 0 };
    }

    // Calculate weights based on source reliability and confidence
    const weights = dataPoints.map(dp => {
      const sourceReliability = this.getSourceReliability(dp.source);
      const dataConfidence = dp.confidence || 0.5;
      return sourceReliability * dataConfidence;
    });

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight === 0) {
      return { value: dataPoints[0].value, confidence: 0 };
    }

    // For numerical data (like prices)
    if (dataPoints[0].dataType === 'price_feed') {
      let weightedPrice = 0;
      
      dataPoints.forEach((dp, index) => {
        weightedPrice += (dp.value.price * weights[index]);
      });
      
      weightedPrice /= totalWeight;
      
      return {
        value: {
          ...dataPoints[0].value,
          price: weightedPrice
        },
        confidence: Math.min(totalWeight / dataPoints.length, 1.0)
      };
    }

    // For non-numerical data, return highest weighted value
    let bestIndex = 0;
    let bestWeight = weights[0];
    
    weights.forEach((weight, index) => {
      if (weight > bestWeight) {
        bestWeight = weight;
        bestIndex = index;
      }
    });

    return {
      value: dataPoints[bestIndex].value,
      confidence: bestWeight
    };
  }

  private medianConsensus(dataPoints: OracleDataPoint[]): { value: any; confidence: number } {
    if (dataPoints.length === 0) {
      return { value: null, confidence: 0 };
    }

    // For price feeds, calculate median price
    if (dataPoints[0].dataType === 'price_feed') {
      const prices = dataPoints.map(dp => dp.value.price).sort((a, b) => a - b);
      const median = prices.length % 2 === 0 
        ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
        : prices[Math.floor(prices.length / 2)];

      return {
        value: {
          ...dataPoints[0].value,
          price: median
        },
        confidence: 0.8 // Median has good confidence for numerical data
      };
    }

    // For other data, return middle value
    const middleIndex = Math.floor(dataPoints.length / 2);
    return {
      value: dataPoints[middleIndex].value,
      confidence: 0.6
    };
  }

  private getSourceReliability(source: string): number {
    // Define reliability scores for different oracle sources
    const reliabilityScores: Record<string, number> = {
      chainlink: 0.95,
      weather: 0.80,
      nasa: 0.90,
      aggregated: 0.85
    };

    return reliabilityScores[source] || 0.5;
  }

  async getAvailableOracleSources(): Promise<any[]> {
    const sources = [];

    try {
      const chainlinkInfo = await this.chainlinkAdapter.getProviderInfo();
      sources.push({
        name: 'chainlink',
        type: 'price_feed',
        ...chainlinkInfo
      });
    } catch (error: any) {
      logger.warn('Chainlink source unavailable', { error: error.message });
    }

    try {
      const weatherInfo = await this.weatherAdapter.getProviderInfo();
      sources.push({
        name: 'weather',
        type: 'weather',
        ...weatherInfo
      });
    } catch (error: any) {
      logger.warn('Weather source unavailable', { error: error.message });
    }

    try {
      const nasaInfo = await this.nasaAdapter.getProviderInfo();
      sources.push({
        name: 'nasa',
        type: 'space',
        ...nasaInfo
      });
    } catch (error: any) {
      logger.warn('NASA source unavailable', { error: error.message });
    }

    return sources;
  }

  async getHistoricalData(dataType: string, options: {
    startTime?: number;
    endTime?: number;
    limit?: number;
    sources?: string[];
  }): Promise<CollectDataResponse> {
    const startExecution = Date.now();

    try {
      logger.info('Getting historical oracle data', {
        dataType,
        options
      });

      // Validate data type
      if (!dataType) {
        throw new Error('Data type is required');
      }

      // Set default options
      const {
        startTime = Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
        endTime = Date.now(),
        limit = 100,
        sources = ['chainlink'] // Default to chainlink for price data
      } = options;

      // For price data, use chainlink adapter's historical data
      if (dataType === 'price_feed' || dataType.includes('/USD')) {
        const symbol = dataType === 'price_feed' ? 'ETH/USD' : dataType;
        
        // Determine timeframe based on time range
        const timeRangeMs = endTime - startTime;
        let timeframe: '1h' | '24h' | '7d' | '30d' = '24h';
        
        if (timeRangeMs <= 60 * 60 * 1000) { // 1 hour
          timeframe = '1h';
        } else if (timeRangeMs <= 24 * 60 * 60 * 1000) { // 24 hours
          timeframe = '24h';
        } else if (timeRangeMs <= 7 * 24 * 60 * 60 * 1000) { // 7 days
          timeframe = '7d';
        } else {
          timeframe = '30d';
        }

        const historicalResponse = await this.chainlinkAdapter.getHistoricalData(symbol, timeframe, limit);
        
        if (!historicalResponse.success) {
          throw new Error(historicalResponse.error || 'Failed to fetch historical data');
        }

        const aggregatedData: AggregatedOracleData = {
          dataType: historicalResponse.data!.dataType,
          sources: [historicalResponse.data!.source],
          aggregatedValue: historicalResponse.data!.value,
          confidence: historicalResponse.data!.confidence || 0.8,
          timestamp: historicalResponse.data!.timestamp,
          dataPoints: [{
            source: historicalResponse.data!.source,
            dataType: historicalResponse.data!.dataType,
            value: historicalResponse.data!.value,
            timestamp: historicalResponse.data!.timestamp,
            confidence: historicalResponse.data!.confidence || 0.8,
            metadata: historicalResponse.data!.metadata
          }],
          consensusMethod: ConsensusMethod.MEDIAN
        };

        logger.info('Historical data retrieved successfully', {
          dataType,
          dataPointCount: historicalResponse.data!.value.count,
          executionTime: Date.now() - startExecution
        });

        return {
          success: true,
          aggregatedData,
          executionTime: Date.now() - startExecution,
          sourcesUsed: [historicalResponse.data!.source],
          consensusAchieved: true
        };
      }

      // For other data types, return current data with timestamp filtering
      const collectResponse = await this.collectData({
        dataType: dataType as OracleDataType,
        sources: sources
      });

      if (!collectResponse.success) {
        throw new Error('Failed to collect current data for historical request');
      }

      // Simulate historical data by modifying timestamps
      const historicalData: AggregatedOracleData = {
        ...collectResponse.aggregatedData!,
        dataPoints: collectResponse.aggregatedData!.dataPoints.map(dp => ({
          ...dp,
          metadata: {
            ...dp.metadata,
            isHistoricalSimulation: true,
            originalDataType: dataType,
            startTime,
            endTime,
            limit
          }
        }))
      };

      return {
        success: true,
        aggregatedData: historicalData,
        executionTime: Date.now() - startExecution,
        sourcesUsed: collectResponse.sourcesUsed,
        consensusAchieved: collectResponse.consensusAchieved
      };

    } catch (error: any) {
      logger.error('Historical data collection failed', {
        dataType,
        options,
        error: error.message,
        executionTime: Date.now() - startExecution
      });

      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startExecution,
        sourcesUsed: [],
        consensusAchieved: false
      };
    }
  }

  async testAllConnections(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    const tests = await Promise.allSettled([
      this.chainlinkAdapter.testConnection(),
      this.weatherAdapter.testConnection(),
      this.nasaAdapter.testConnection()
    ]);

    results.chainlink = tests[0].status === 'fulfilled' ? tests[0].value : false;
    results.weather = tests[1].status === 'fulfilled' ? tests[1].value : false;
    results.nasa = tests[2].status === 'fulfilled' ? tests[2].value : false;

    logger.info('Oracle connection test results', results);
    return results;
  }
}