import express from 'express';
import { OracleAggregationService, CollectDataRequest } from '../services/oracle/oracleAggregationService';
import { OracleDataType, ConsensusMethod } from '../services/oracle/oracleTypes';
import { logger } from '../utils/logger';
import { ValidationError } from '../middleware/errorHandler';

const router = express.Router();
const oracleService = new OracleAggregationService();

/**
 * @swagger
 * components:
 *   schemas:
 *     CollectDataRequest:
 *       type: object
 *       required:
 *         - dataType
 *         - sources
 *       properties:
 *         dataType:
 *           type: string
 *           enum: [price_feed, weather, space, crypto_metrics, iot_sensor, financial]
 *           description: Type of data to collect
 *         sources:
 *           type: array
 *           items:
 *             type: string
 *           description: Oracle sources to use (chainlink, weather, nasa)
 *         parameters:
 *           type: object
 *           description: Specific parameters for the data request
 *         consensusMethod:
 *           type: string
 *           enum: [majority, weighted_average, median, ai_consensus]
 *           description: Method to calculate consensus
 *     
 *     AggregatedOracleData:
 *       type: object
 *       properties:
 *         dataType:
 *           type: string
 *         sources:
 *           type: array
 *           items:
 *             type: string
 *         aggregatedValue:
 *           type: object
 *         confidence:
 *           type: number
 *         timestamp:
 *           type: number
 *         consensusMethod:
 *           type: string
 */

/**
 * @swagger
 * /api/v1/oracle/collect:
 *   post:
 *     summary: Collect and aggregate data from multiple oracle sources
 *     tags: [Oracle]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CollectDataRequest'
 *           examples:
 *             priceData:
 *               summary: Collect price data
 *               value:
 *                 dataType: "price_feed"
 *                 sources: ["chainlink"]
 *                 parameters:
 *                   symbol: "ETH/USD"
 *                 consensusMethod: "weighted_average"
 *             weatherData:
 *               summary: Collect weather data
 *               value:
 *                 dataType: "weather"
 *                 sources: ["weather"]
 *                 parameters:
 *                   city: "London"
 *             spaceData:
 *               summary: Collect space data
 *               value:
 *                 dataType: "space"
 *                 sources: ["nasa"]
 *                 parameters:
 *                   spaceDataType: "asteroid"
 *                   date: "2024-01-15"
 *     responses:
 *       200:
 *         description: Successfully aggregated oracle data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AggregatedOracleData'
 *                 executionTime:
 *                   type: number
 *                 sourcesUsed:
 *                   type: array
 *                   items:
 *                     type: string
 *                 consensusAchieved:
 *                   type: boolean
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Oracle data collection failed
 */
router.post('/collect', async (req, res, next) => {
  try {
    const { dataType, sources, parameters, consensusMethod } = req.body;

    // Validate required fields
    if (!dataType || !sources) {
      throw new ValidationError('dataType and sources are required');
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      throw new ValidationError('sources must be a non-empty array');
    }

    // Validate dataType
    if (!Object.values(OracleDataType).includes(dataType)) {
      throw new ValidationError(`Invalid dataType. Must be one of: ${Object.values(OracleDataType).join(', ')}`);
    }

    // Validate consensusMethod if provided
    if (consensusMethod && !Object.values(ConsensusMethod).includes(consensusMethod)) {
      throw new ValidationError(`Invalid consensusMethod. Must be one of: ${Object.values(ConsensusMethod).join(', ')}`);
    }

    // Validate sources
    const validSources = ['chainlink', 'weather', 'nasa'];
    const invalidSources = sources.filter((source: string) => !validSources.includes(source));
    if (invalidSources.length > 0) {
      throw new ValidationError(`Invalid sources: ${invalidSources.join(', ')}. Valid sources: ${validSources.join(', ')}`);
    }

    // Validate parameters based on dataType
    if (dataType === OracleDataType.PRICE_FEED && (!parameters?.symbol)) {
      throw new ValidationError('symbol parameter is required for price_feed data');
    }

    if (dataType === OracleDataType.WEATHER && (!parameters?.city)) {
      throw new ValidationError('city parameter is required for weather data');
    }

    logger.info('Oracle data collection request received', {
      dataType,
      sources,
      parameters,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const request: CollectDataRequest = {
      dataType,
      sources,
      parameters,
      consensusMethod
    };

    const result = await oracleService.collectData(request);

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: result.error,
        executionTime: result.executionTime,
        sourcesUsed: result.sourcesUsed,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: result.aggregatedData,
      executionTime: result.executionTime,
      sourcesUsed: result.sourcesUsed,
      consensusAchieved: result.consensusAchieved,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/oracle/sources:
 *   get:
 *     summary: Get available oracle sources and their status
 *     tags: [Oracle]
 *     responses:
 *       200:
 *         description: List of available oracle sources
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       status:
 *                         type: string
 *                       provider:
 *                         type: string
 */
router.get('/sources', async (req, res, next) => {
  try {
    logger.info('Oracle sources request received', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const sources = await oracleService.getAvailableOracleSources();

    res.json({
      success: true,
      data: sources,
      count: sources.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/oracle/health:
 *   get:
 *     summary: Check health status of all oracle connections
 *     tags: [Oracle]
 *     responses:
 *       200:
 *         description: Health status of oracle connections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: boolean
 *                 healthyCount:
 *                   type: number
 *                 totalCount:
 *                   type: number
 */
router.get('/health', async (req, res, next) => {
  try {
    logger.info('Oracle health check request received');

    const healthResults = await oracleService.testAllConnections();
    const healthyCount = Object.values(healthResults).filter(status => status).length;
    const totalCount = Object.keys(healthResults).length;

    res.json({
      success: true,
      data: healthResults,
      healthyCount: healthyCount,
      totalCount: totalCount,
      overallHealth: healthyCount === totalCount ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/oracle/data/{dataType}:
 *   get:
 *     summary: Get cached or historical oracle data by type
 *     tags: [Oracle]
 *     parameters:
 *       - in: path
 *         name: dataType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [price_feed, weather, space, crypto_metrics]
 *         description: Type of oracle data to retrieve
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *         description: Filter by specific oracle source
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of records to return
 *     responses:
 *       200:
 *         description: Historical oracle data
 *       404:
 *         description: No data found for specified type
 */
router.get('/data/:dataType', async (req, res, next) => {
  try {
    const { dataType } = req.params;
    const { source, limit = '100' } = req.query;

    // Validate dataType
    if (!Object.values(OracleDataType).includes(dataType as OracleDataType)) {
      throw new ValidationError(`Invalid dataType. Must be one of: ${Object.values(OracleDataType).join(', ')}`);
    }

    logger.info('Oracle data retrieval request received', {
      dataType,
      source,
      limit,
      ip: req.ip
    });

    // Query historical data from 0G Storage/DA layer
    try {
      // Implementation would query stored oracle data from 0G network
      const historicalData = await oracleService.getHistoricalData(dataType, {
        source: source || 'all',
        startTime: startTime ? parseInt(startTime) : Date.now() - 24 * 60 * 60 * 1000,
        endTime: endTime ? parseInt(endTime) : Date.now(),
        limit: limit ? parseInt(limit) : 100
      });

      res.json({
        success: true,
        data: historicalData,
        timestamp: new Date().toISOString()
      });
    } catch (storageError: any) {
      logger.warn('Historical data not available, returning empty result', { error: storageError.message });
      
      res.json({
        success: true,
        data: {
          dataType: dataType,
          source: source || 'all',
          records: [],
          totalCount: 0,
          message: 'Historical data not available - 0G Storage layer not accessible'
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error: any) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/oracle/consensus/methods:
 *   get:
 *     summary: Get available consensus methods
 *     tags: [Oracle]
 *     responses:
 *       200:
 *         description: List of available consensus methods
 */
router.get('/consensus/methods', async (req, res, next) => {
  try {
    const consensusMethods = Object.values(ConsensusMethod).map(method => ({
      value: method,
      description: this.getConsensusMethodDescription(method)
    }));

    res.json({
      success: true,
      data: consensusMethods,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    next(error);
  }
});

// Helper function for consensus method descriptions
function getConsensusMethodDescription(method: ConsensusMethod): string {
  switch (method) {
    case ConsensusMethod.MAJORITY_VOTE:
      return 'Uses majority voting to determine consensus value';
    case ConsensusMethod.WEIGHTED_AVERAGE:
      return 'Calculates weighted average based on source reliability';
    case ConsensusMethod.MEDIAN:
      return 'Uses median value to avoid outlier influence';
    case ConsensusMethod.AI_CONSENSUS:
      return 'AI-powered consensus using 0G Compute Network (future implementation)';
    default:
      return 'Unknown consensus method';
  }
}

/**
 * @swagger
 * /api/v1/oracle/test:
 *   post:
 *     summary: Test oracle data collection with sample parameters
 *     tags: [Oracle]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               source:
 *                 type: string
 *                 enum: [chainlink, weather, nasa]
 *                 description: Oracle source to test
 *             required:
 *               - source
 *     responses:
 *       200:
 *         description: Test result
 */
router.post('/test', async (req, res, next) => {
  try {
    const { source } = req.body;

    if (!source) {
      throw new ValidationError('source parameter is required');
    }

    logger.info('Oracle test request received', { source, ip: req.ip });

    // Test with sample data based on source
    let testRequest: CollectDataRequest;

    switch (source) {
      case 'chainlink':
        testRequest = {
          dataType: OracleDataType.PRICE_FEED,
          sources: ['chainlink'],
          parameters: { symbol: 'ETH/USD' },
          consensusMethod: ConsensusMethod.WEIGHTED_AVERAGE
        };
        break;
      
      case 'weather':
        testRequest = {
          dataType: OracleDataType.WEATHER,
          sources: ['weather'],
          parameters: { city: 'London' }
        };
        break;
      
      case 'nasa':
        testRequest = {
          dataType: OracleDataType.SPACE,
          sources: ['nasa'],
          parameters: { spaceDataType: 'apod' }
        };
        break;
      
      default:
        throw new ValidationError('Invalid source. Must be one of: chainlink, weather, nasa');
    }

    const result = await oracleService.collectData(testRequest);

    res.json({
      success: result.success,
      testSource: source,
      data: result.success ? result.aggregatedData : undefined,
      error: result.error,
      executionTime: result.executionTime,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    next(error);
  }
});

export default router;