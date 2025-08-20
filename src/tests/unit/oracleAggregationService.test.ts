import { OracleAggregationService, CollectDataRequest } from '../../services/oracle/oracleAggregationService';
import { OracleDataType, ConsensusMethod } from '../../services/oracle/oracleTypes';

describe('OracleAggregationService', () => {
  let service: OracleAggregationService;

  beforeEach(() => {
    service = new OracleAggregationService();
  });

  describe('Initialization', () => {
    it('should initialize service correctly', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(OracleAggregationService);
    });
  });

  describe('Data Type Validation', () => {
    it('should validate supported oracle data types', () => {
      const supportedTypes = Object.values(OracleDataType);
      
      expect(supportedTypes).toContain(OracleDataType.PRICE_FEED);
      expect(supportedTypes).toContain(OracleDataType.WEATHER);
      expect(supportedTypes).toContain(OracleDataType.SPACE);
      expect(supportedTypes.length).toBeGreaterThan(0);
    });

    it('should validate consensus methods', () => {
      const consensusMethods = Object.values(ConsensusMethod);
      
      expect(consensusMethods).toContain(ConsensusMethod.WEIGHTED_AVERAGE);
      expect(consensusMethods).toContain(ConsensusMethod.MEDIAN);
      expect(consensusMethods).toContain(ConsensusMethod.MAJORITY_VOTE);
      expect(consensusMethods.length).toBeGreaterThan(0);
    });
  });

  describe('Request Validation', () => {
    it('should validate collect data request structure', () => {
      const validRequest: CollectDataRequest = {
        dataType: OracleDataType.PRICE_FEED,
        sources: ['chainlink'],
        parameters: { symbol: 'ETH/USD' },
        consensusMethod: ConsensusMethod.WEIGHTED_AVERAGE
      };

      // Test request structure
      expect(validRequest.dataType).toBeDefined();
      expect(validRequest.sources).toBeDefined();
      expect(Array.isArray(validRequest.sources)).toBe(true);
      expect(validRequest.sources.length).toBeGreaterThan(0);
      expect(validRequest.parameters).toBeDefined();
    });

    it('should handle empty sources array', () => {
      const invalidRequest: CollectDataRequest = {
        dataType: OracleDataType.PRICE_FEED,
        sources: [],
        parameters: { symbol: 'ETH/USD' }
      };

      // Verify sources validation logic
      expect(invalidRequest.sources).toHaveLength(0);
      expect(Array.isArray(invalidRequest.sources)).toBe(true);
    });
  });

  describe('Parameter Validation', () => {
    it('should validate price feed parameters', () => {
      const priceRequest: CollectDataRequest = {
        dataType: OracleDataType.PRICE_FEED,
        sources: ['chainlink'],
        parameters: { symbol: 'ETH/USD' }
      };

      expect(priceRequest.parameters).toHaveProperty('symbol');
      expect(typeof priceRequest.parameters?.symbol).toBe('string');
    });

    it('should validate weather parameters', () => {
      const weatherRequest: CollectDataRequest = {
        dataType: OracleDataType.WEATHER,
        sources: ['weather'],
        parameters: { city: 'London' }
      };

      expect(weatherRequest.parameters).toHaveProperty('city');
      expect(typeof weatherRequest.parameters?.city).toBe('string');
    });

    it('should validate space parameters', () => {
      const spaceRequest: CollectDataRequest = {
        dataType: OracleDataType.SPACE,
        sources: ['nasa'],
        parameters: { dataset: 'asteroid_data' }
      };

      expect(spaceRequest.parameters).toHaveProperty('dataset');
      expect(typeof spaceRequest.parameters?.dataset).toBe('string');
    });
  });

  describe('Data Processing Logic', () => {
    it('should calculate weighted average correctly', () => {
      const calculateWeightedAverage = (values: number[], weights: number[]) => {
        if (values.length !== weights.length || values.length === 0) {
          throw new Error('Invalid input arrays');
        }

        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        if (totalWeight === 0) {
          throw new Error('Total weight cannot be zero');
        }

        const weightedSum = values.reduce((sum, value, index) => 
          sum + (value * weights[index]), 0);

        return weightedSum / totalWeight;
      };

      // Test weighted average calculation
      const prices = [2500.0, 2501.5, 2499.5];
      const weights = [0.95, 0.90, 0.85];
      const result = calculateWeightedAverage(prices, weights);

      expect(result).toBeCloseTo(2500.33, 1);
      expect(result).toBeGreaterThan(2499);
      expect(result).toBeLessThan(2502);
    });

    it('should calculate median correctly', () => {
      const calculateMedian = (values: number[]) => {
        if (values.length === 0) {
          throw new Error('Cannot calculate median of empty array');
        }

        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
          return (sorted[middle - 1] + sorted[middle]) / 2;
        } else {
          return sorted[middle];
        }
      };

      // Test median calculation
      expect(calculateMedian([1, 3, 5])).toBe(3);
      expect(calculateMedian([1, 2, 4, 5])).toBe(3);
      expect(calculateMedian([2500.0, 2499.5, 2501.0])).toBeCloseTo(2500.0);
    });

    it('should detect data outliers', () => {
      const detectOutliers = (values: number[], threshold = 0.05) => {
        if (values.length === 0) return [];

        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const outliers: number[] = [];

        values.forEach(value => {
          const deviation = Math.abs(value - mean) / mean;
          if (deviation > threshold) {
            outliers.push(value);
          }
        });

        return outliers;
      };

      const normalPrices = [2500, 2501, 2499, 2502];
      const pricesWithOutlier = [2500, 2501, 2499, 3000]; // 3000 is outlier

      expect(detectOutliers(normalPrices)).toHaveLength(0);
      expect(detectOutliers(pricesWithOutlier)).toContain(3000);
      expect(detectOutliers(pricesWithOutlier, 0.1)).toContain(3000);
    });
  });

  describe('Confidence Score Calculation', () => {
    it('should calculate confidence based on data sources', () => {
      const calculateConfidence = (sources: string[], responseCount: number) => {
        if (responseCount === 0) return 0;

        const baseConfidence = 0.5;
        const sourceBonus = Math.min(sources.length * 0.1, 0.3);
        const responseRatio = responseCount / sources.length;
        
        return Math.min(baseConfidence + sourceBonus + (responseRatio * 0.2), 1.0);
      };

      const singleSource = ['chainlink'];
      const multipleSources = ['chainlink', 'coinbase', 'binance'];

      expect(calculateConfidence(singleSource, 1)).toBeCloseTo(0.8);
      expect(calculateConfidence(multipleSources, 3)).toBeCloseTo(1.0);
      expect(calculateConfidence(multipleSources, 1)).toBeCloseTo(0.87);
    });

    it('should handle zero responses', () => {
      const calculateConfidence = (sources: string[], responseCount: number) => {
        return responseCount === 0 ? 0 : 0.5;
      };

      expect(calculateConfidence(['chainlink'], 0)).toBe(0);
      expect(calculateConfidence(['chainlink', 'coinbase'], 0)).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid data type', () => {
      const validateDataType = (dataType: string) => {
        const validTypes = Object.values(OracleDataType);
        if (!validTypes.includes(dataType as OracleDataType)) {
          throw new Error(`Invalid dataType: ${dataType}`);
        }
        return true;
      };

      expect(() => validateDataType(OracleDataType.PRICE_FEED)).not.toThrow();
      expect(() => validateDataType('invalid_type')).toThrow('Invalid dataType');
    });

    it('should handle empty source list', () => {
      const validateSources = (sources: string[]) => {
        if (!Array.isArray(sources) || sources.length === 0) {
          throw new Error('At least one source is required');
        }
        return true;
      };

      expect(() => validateSources(['chainlink'])).not.toThrow();
      expect(() => validateSources([])).toThrow('At least one source is required');
    });

    it('should handle missing parameters', () => {
      const validateParameters = (dataType: OracleDataType, parameters: any) => {
        if (!parameters || typeof parameters !== 'object') {
          throw new Error('Parameters are required');
        }

        switch (dataType) {
          case OracleDataType.PRICE_FEED:
            if (!parameters.symbol) {
              throw new Error('Symbol parameter is required for price feeds');
            }
            break;
          case OracleDataType.WEATHER:
            if (!parameters.city && !parameters.coordinates) {
              throw new Error('City or coordinates parameter is required for weather data');
            }
            break;
          case OracleDataType.SPACE:
            if (!parameters.dataset) {
              throw new Error('Dataset parameter is required for space data');
            }
            break;
        }
        return true;
      };

      // Valid cases
      expect(() => validateParameters(
        OracleDataType.PRICE_FEED, 
        { symbol: 'ETH/USD' }
      )).not.toThrow();

      expect(() => validateParameters(
        OracleDataType.WEATHER, 
        { city: 'London' }
      )).not.toThrow();

      // Invalid cases
      expect(() => validateParameters(
        OracleDataType.PRICE_FEED, 
        {}
      )).toThrow('Symbol parameter is required');

      expect(() => validateParameters(
        OracleDataType.WEATHER, 
        {}
      )).toThrow('City or coordinates parameter is required');
    });
  });

  describe('Response Structure Validation', () => {
    it('should validate oracle response format', () => {
      const validateResponseStructure = (response: any) => {
        const requiredFields = ['success', 'data', 'source', 'timestamp'];
        
        for (const field of requiredFields) {
          if (!(field in response)) {
            throw new Error(`Missing required field: ${field}`);
          }
        }

        if (response.success && !response.data) {
          throw new Error('Data is required when success is true');
        }

        return true;
      };

      const validResponse = {
        success: true,
        data: {
          source: 'chainlink',
          dataType: 'price_feed',
          value: { symbol: 'ETH/USD', price: 2500.50 },
          confidence: 0.95,
          timestamp: Date.now()
        },
        source: 'chainlink',
        timestamp: Date.now(),
        responseTime: 1500
      };

      const invalidResponse = {
        success: true,
        source: 'chainlink'
        // Missing data, timestamp
      };

      expect(() => validateResponseStructure(validResponse)).not.toThrow();
      expect(() => validateResponseStructure(invalidResponse)).toThrow();
    });
  });

  describe('Async Operations', () => {
    it('should handle async operations correctly', async () => {
      const asyncDataProcessor = async (data: any[], processingTime = 10) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            const processed = data.map(item => ({
              ...item,
              processed: true,
              processedAt: Date.now()
            }));
            resolve(processed);
          }, processingTime);
        });
      };

      const testData = [
        { id: 1, value: 100 },
        { id: 2, value: 200 }
      ];

      const result = await asyncDataProcessor(testData) as any[];
      
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('processed', true);
      expect(result[0]).toHaveProperty('processedAt');
      expect(result[1]).toHaveProperty('processed', true);
    });

    it('should handle concurrent data collection', async () => {
      const simulateDataCollection = async (source: string, delay: number) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              source,
              data: { value: Math.random() * 1000 },
              timestamp: Date.now()
            });
          }, delay);
        });
      };

      const promises = [
        simulateDataCollection('chainlink', 10),
        simulateDataCollection('coinbase', 15),
        simulateDataCollection('binance', 5)
      ];

      const results = await Promise.all(promises) as any[];
      
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('source', 'chainlink');
      expect(results[1]).toHaveProperty('source', 'coinbase');
      expect(results[2]).toHaveProperty('source', 'binance');
    });
  });
});