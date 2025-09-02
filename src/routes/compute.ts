import express from 'express';
import { ZeroGComputeService, AIInferenceRequest, OracleConsensusRequest } from '../services/compute/zeroGComputeService';
import { logger } from '../utils/logger';
import { ValidationError, StorageError } from '../middleware/errorHandler';

const router = express.Router();
const computeService = new ZeroGComputeService();

/**
 * @swagger
 * components:
 *   schemas:
 *     AIInferenceRequest:
 *       type: object
 *       required:
 *         - prompt
 *       properties:
 *         model:
 *           type: string
 *           default: "llama-3.1-8b-instant"
 *           description: AI model to use for inference
 *         prompt:
 *           type: string
 *           description: Text prompt for AI inference
 *         maxTokens:
 *           type: number
 *           default: 150
 *           description: Maximum tokens to generate
 *         temperature:
 *           type: number
 *           minimum: 0
 *           maximum: 2
 *           default: 0.7
 *           description: Randomness in generation (0 = deterministic)
 *         topP:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           default: 0.9
 *           description: Nucleus sampling parameter
 *         systemPrompt:
 *           type: string
 *           description: System prompt to guide AI behavior
 *         metadata:
 *           type: object
 *           description: Additional metadata for the request
 *     
 *     AIInferenceResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         jobId:
 *           type: string
 *         result:
 *           type: object
 *           properties:
 *             response:
 *               type: string
 *             tokensUsed:
 *               type: number
 *             executionTime:
 *               type: number
 *             model:
 *               type: string
 *             confidence:
 *               type: number
 *         txHash:
 *           type: string
 *         computeNodeId:
 *           type: string
 *         teeVerified:
 *           type: boolean
 *         error:
 *           type: string
 *     
 *     ComputeJobInfo:
 *       type: object
 *       properties:
 *         jobId:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, running, completed, failed, cancelled]
 *         model:
 *           type: string
 *         requestTime:
 *           type: string
 *           format: date-time
 *         completionTime:
 *           type: string
 *           format: date-time
 *         result:
 *           type: object
 *         computeNodeId:
 *           type: string
 *         txHash:
 *           type: string
 *         gasUsed:
 *           type: string
 *         teeVerified:
 *           type: boolean
 *     
 *     ComputeNetworkStatus:
 *       type: object
 *       properties:
 *         contract:
 *           type: object
 *         availableModels:
 *           type: array
 *           items:
 *             type: string
 *         activeNodes:
 *           type: number
 *         totalJobs:
 *           type: number
 *         avgResponseTime:
 *           type: number
 *         teeEnabled:
 *           type: boolean
 *         limits:
 *           type: object
 *         pricing:
 *           type: object
 *         status:
 *           type: string
 *           enum: [connected, degraded, disconnected]
 *     
 *     OracleConsensusRequest:
 *       type: object
 *       required:
 *         - oracleResponses
 *         - dataType
 *       properties:
 *         oracleResponses:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               source:
 *                 type: string
 *               data:
 *                 type: object
 *               confidence:
 *                 type: number
 *               timestamp:
 *                 type: number
 *         consensusMethod:
 *           type: string
 *           enum: [ai_weighted, ai_outlier_detection, ai_correlation_analysis]
 *           default: ai_weighted
 *         dataType:
 *           type: string
 *         additionalContext:
 *           type: string
 */

/**
 * @swagger
 * /api/v1/compute/inference:
 *   post:
 *     summary: Submit AI inference job to 0G Compute Network
 *     tags: [Compute]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AIInferenceRequest'
 *           examples:
 *             simpleInference:
 *               summary: Simple text generation
 *               value:
 *                 prompt: "Explain blockchain technology in simple terms"
 *                 maxTokens: 200
 *                 temperature: 0.7
 *             oracleAnalysis:
 *               summary: Oracle data analysis
 *               value:
 *                 model: "llama-3.1-70b-versatile"
 *                 prompt: "Analyze this price data and detect any anomalies: ETH/USD prices over last hour: [2500, 2505, 2498, 2502, 2501]"
 *                 maxTokens: 300
 *                 systemPrompt: "You are an expert financial analyst specializing in cryptocurrency markets."
 *     responses:
 *       200:
 *         description: Inference job submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/AIInferenceResult'
 *       400:
 *         description: Invalid inference request
 *       413:
 *         description: Prompt too large
 *       500:
 *         description: Inference failed
 */
router.post('/inference', async (req, res, next) => {
  try {
    const { model, prompt, maxTokens, temperature, topP, systemPrompt, metadata, walletAddress } = req.body;

    // Validate required fields
    if (!prompt) {
      throw new ValidationError('prompt is required');
    }

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new ValidationError('prompt must be a non-empty string');
    }

    // Validate optional parameters
    if (maxTokens !== undefined && (typeof maxTokens !== 'number' || maxTokens < 1 || maxTokens > 4000)) {
      throw new ValidationError('maxTokens must be a number between 1 and 4000');
    }

    if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
      throw new ValidationError('temperature must be a number between 0 and 2');
    }

    if (topP !== undefined && (typeof topP !== 'number' || topP < 0 || topP > 1)) {
      throw new ValidationError('topP must be a number between 0 and 1');
    }

    logger.info('Compute inference request received', {
      model: model || 'default',
      promptLength: prompt.length,
      maxTokens: maxTokens || 'default',
      temperature: temperature || 'default',
      hasSystemPrompt: !!systemPrompt,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const inferenceRequest: AIInferenceRequest = {
      model,
      prompt,
      maxTokens,
      temperature,
      topP,
      systemPrompt,
      metadata,
      walletAddress
    };

    const result = await computeService.submitInferenceJob(inferenceRequest);

    if (!result.success) {
      throw new StorageError(result.error || 'Inference job failed');
    }

    logger.info('Inference job completed successfully', {
      jobId: result.jobId,
      model: result.result?.model,
      tokensUsed: result.result?.tokensUsed,
      executionTime: result.result?.executionTime,
      teeVerified: result.teeVerified
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Compute inference failed', {
      error: error.message,
      promptLength: req.body?.prompt?.length,
      model: req.body?.model
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/compute/job/{jobId}:
 *   get:
 *     summary: Get compute job information
 *     tags: [Compute]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID to get information for
 *     responses:
 *       200:
 *         description: Job information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ComputeJobInfo'
 *       400:
 *         description: Invalid job ID format
 *       404:
 *         description: Job not found
 */
router.get('/job/:jobId', async (req, res, next) => {
  try {
    const { jobId } = req.params;

    // Validate jobId format
    if (!jobId || !/^0x[a-fA-F0-9]{64}$/.test(jobId)) {
      throw new ValidationError('Invalid jobId format. Must be 0x prefixed 64-character hex string');
    }

    logger.info('Compute job info request received', {
      jobId,
      ip: req.ip
    });

    const jobInfo = await computeService.getJobInfo(jobId);

    if (!jobInfo) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
        jobId: jobId,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: jobInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Compute job info failed', {
      jobId: req.params.jobId,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/compute/oracle-consensus:
 *   post:
 *     summary: Perform AI-powered oracle consensus analysis
 *     tags: [Compute]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OracleConsensusRequest'
 *           example:
 *             oracleResponses:
 *               - source: "chainlink"
 *                 data: {"symbol": "ETH/USD", "price": 2500.50}
 *                 confidence: 0.95
 *                 timestamp: 1703087400000
 *               - source: "coinbase"
 *                 data: {"symbol": "ETH/USD", "price": 2499.80}
 *                 confidence: 0.90
 *                 timestamp: 1703087401000
 *               - source: "binance"
 *                 data: {"symbol": "ETH/USD", "price": 2501.20}
 *                 confidence: 0.92
 *                 timestamp: 1703087402000
 *             consensusMethod: "ai_weighted"
 *             dataType: "price_feed"
 *             additionalContext: "Normal market conditions, high liquidity period"
 *     responses:
 *       200:
 *         description: Oracle consensus analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     consensusValue:
 *                       type: object
 *                     confidence:
 *                       type: number
 *                     reasoning:
 *                       type: string
 *                     outliers:
 *                       type: array
 *                       items:
 *                         type: string
 *                     aiAnalysis:
 *                       type: object
 *                     jobId:
 *                       type: string
 *       400:
 *         description: Invalid oracle consensus request
 *       500:
 *         description: Consensus analysis failed
 */
router.post('/oracle-consensus', async (req, res, next) => {
  try {
    const { oracleResponses, consensusMethod, dataType, additionalContext } = req.body;

    // Validate required fields
    if (!oracleResponses) {
      throw new ValidationError('oracleResponses is required');
    }

    if (!Array.isArray(oracleResponses) || oracleResponses.length === 0) {
      throw new ValidationError('oracleResponses must be a non-empty array');
    }

    if (!dataType) {
      throw new ValidationError('dataType is required');
    }

    // Validate oracle responses structure
    for (let i = 0; i < oracleResponses.length; i++) {
      const resp = oracleResponses[i];
      if (!resp.source || !resp.data || typeof resp.confidence !== 'number' || typeof resp.timestamp !== 'number') {
        throw new ValidationError(`Invalid oracle response at index ${i}. Must have source, data, confidence, and timestamp`);
      }

      if (resp.confidence < 0 || resp.confidence > 1) {
        throw new ValidationError(`Invalid confidence at index ${i}. Must be between 0 and 1`);
      }
    }

    // Validate consensus method
    const validMethods = ['ai_weighted', 'ai_outlier_detection', 'ai_correlation_analysis'];
    const method = consensusMethod || 'ai_weighted';
    if (!validMethods.includes(method)) {
      throw new ValidationError(`Invalid consensusMethod. Must be one of: ${validMethods.join(', ')}`);
    }

    logger.info('Oracle consensus request received', {
      dataType,
      consensusMethod: method,
      responseCount: oracleResponses.length,
      sources: oracleResponses.map(r => r.source),
      hasContext: !!additionalContext,
      ip: req.ip
    });

    const consensusRequest: OracleConsensusRequest = {
      oracleResponses,
      consensusMethod: method,
      dataType,
      additionalContext
    };

    const result = await computeService.performOracleConsensus(consensusRequest);

    if (!result.success) {
      throw new StorageError(result.error || 'Oracle consensus failed');
    }

    logger.info('Oracle consensus completed successfully', {
      jobId: result.jobId,
      confidence: result.confidence,
      outliersDetected: result.outliers?.length || 0,
      consensusMethod: method
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Oracle consensus failed', {
      error: error.message,
      dataType: req.body?.dataType,
      consensusMethod: req.body?.consensusMethod
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/compute/models:
 *   get:
 *     summary: Get available AI models on 0G Compute Network
 *     tags: [Compute]
 *     responses:
 *       200:
 *         description: Available models retrieved successfully
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
 *                       description:
 *                         type: string
 *                       maxTokens:
 *                         type: number
 *                       costPerToken:
 *                         type: string
 *                       capabilities:
 *                         type: array
 *                         items:
 *                           type: string
 *       503:
 *         description: Compute network unavailable
 */
router.get('/models', async (req, res, next) => {
  try {
    logger.info('Available models request received', { ip: req.ip });

    const networkStatus = await computeService.getNetworkStatus();

    if (networkStatus.status === 'disconnected') {
      return res.status(503).json({
        success: false,
        error: 'Compute network unavailable',
        timestamp: new Date().toISOString()
      });
    }

    // Enrich model info with descriptions and capabilities
    const modelsWithInfo = networkStatus.availableModels.map(modelName => {
      const modelInfo = getModelInfo(modelName);
      return {
        name: modelName,
        description: modelInfo.description,
        maxTokens: modelInfo.maxTokens,
        costPerToken: networkStatus.pricing.baseCostPerToken,
        capabilities: modelInfo.capabilities
      };
    });

    res.json({
      success: true,
      data: modelsWithInfo,
      count: modelsWithInfo.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Models request failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/compute/status:
 *   get:
 *     summary: Get 0G Compute Network status
 *     tags: [Compute]
 *     responses:
 *       200:
 *         description: Compute network status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ComputeNetworkStatus'
 *       503:
 *         description: Compute network connection failed
 */
router.get('/status', async (req, res, next) => {
  try {
    logger.info('Compute status request received', { ip: req.ip });

    const networkStatus = await computeService.getNetworkStatus();

    if (networkStatus.status === 'disconnected') {
      return res.status(503).json({
        success: false,
        data: networkStatus,
        error: 'Compute network connection failed',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: networkStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Compute status check failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/compute/estimate-cost:
 *   post:
 *     summary: Estimate cost for AI inference job
 *     tags: [Compute]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - maxTokens
 *             properties:
 *               model:
 *                 type: string
 *                 description: AI model name
 *               maxTokens:
 *                 type: number
 *                 description: Maximum tokens to generate
 *               teeVerification:
 *                 type: boolean
 *                 description: Whether to use TEE verification
 *           example:
 *             model: "llama-3.1-8b-instant"
 *             maxTokens: 200
 *             teeVerification: false
 *     responses:
 *       200:
 *         description: Cost estimation completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     baseCost:
 *                       type: string
 *                     teeVerificationCost:
 *                       type: string
 *                     totalCost:
 *                       type: string
 *                     maxTokens:
 *                       type: number
 *                     model:
 *                       type: string
 *                     currency:
 *                       type: string
 */
router.post('/estimate-cost', async (req, res, next) => {
  try {
    const { model, maxTokens, teeVerification } = req.body;

    if (!model) {
      throw new ValidationError('model is required');
    }

    if (!maxTokens || typeof maxTokens !== 'number' || maxTokens < 1) {
      throw new ValidationError('maxTokens must be a positive number');
    }

    logger.info('Compute cost estimation request received', {
      model,
      maxTokens,
      teeVerification: !!teeVerification,
      ip: req.ip
    });

    // Get network pricing info
    const networkStatus = await computeService.getNetworkStatus();
    
    const baseCostPerToken = parseFloat(networkStatus.pricing.baseCostPerToken);
    const baseCost = baseCostPerToken * maxTokens;
    
    const teeVerificationCost = teeVerification ? parseFloat(networkStatus.pricing.teeVerificationCost) : 0;
    const totalCost = baseCost + teeVerificationCost;

    res.json({
      success: true,
      data: {
        baseCost: baseCost.toFixed(6),
        teeVerificationCost: teeVerificationCost.toFixed(6),
        totalCost: totalCost.toFixed(6),
        maxTokens,
        model,
        currency: networkStatus.pricing.currency
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Compute cost estimation failed', {
      error: error.message,
      model: req.body?.model,
      maxTokens: req.body?.maxTokens
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/compute/test:
 *   post:
 *     summary: Test 0G Compute Network with sample inference
 *     tags: [Compute]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               model:
 *                 type: string
 *                 default: "llama-3.1-8b-instant"
 *               prompt:
 *                 type: string
 *                 default: "What is 2+2?"
 *     responses:
 *       200:
 *         description: Compute test completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *       500:
 *         description: Compute test failed
 */
router.post('/test', async (req, res, next) => {
  try {
    const testModel = req.body.model || 'llama-3.1-8b-instant';
    const testPrompt = req.body.prompt || 'What is 2+2? Give a brief answer.';

    logger.info('Compute test requested', {
      model: testModel,
      prompt: testPrompt,
      ip: req.ip
    });

    const startTime = Date.now();

    // Test inference
    const inferenceResult = await computeService.submitInferenceJob({
      model: testModel,
      prompt: testPrompt,
      maxTokens: 50,
      temperature: 0.1,
      systemPrompt: 'You are a helpful assistant that gives concise answers.'
    });

    const testResults = {
      inference: {
        success: inferenceResult.success,
        jobId: inferenceResult.jobId,
        response: inferenceResult.result?.response,
        tokensUsed: inferenceResult.result?.tokensUsed,
        executionTime: inferenceResult.result?.executionTime,
        teeVerified: inferenceResult.teeVerified,
        error: inferenceResult.error
      },
      networkStatus: await computeService.getNetworkStatus(),
      totalTestTime: Date.now() - startTime
    };

    logger.info('Compute test completed', {
      success: inferenceResult.success,
      jobId: inferenceResult.jobId,
      totalTestTime: testResults.totalTestTime
    });

    res.json({
      success: true,
      results: testResults,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Compute test failed', {
      error: error.message
    });
    next(error);
  }
});

// Helper function for model information
function getModelInfo(modelName: string): { description: string; maxTokens: number; capabilities: string[] } {
  const modelInfoMap: Record<string, { description: string; maxTokens: number; capabilities: string[] }> = {
    'llama-3.1-8b-instant': {
      description: 'Fast Llama 3.1 8B model optimized for quick responses',
      maxTokens: 8192,
      capabilities: ['text-generation', 'conversation', 'analysis']
    },
    'llama-3.1-70b-versatile': {
      description: 'Large Llama 3.1 70B model for complex reasoning tasks',
      maxTokens: 8192,
      capabilities: ['complex-reasoning', 'analysis', 'code-generation', 'oracle-consensus']
    },
    'mixtral-8x7b-32768': {
      description: 'Mixtral 8x7B model with large context window',
      maxTokens: 32768,
      capabilities: ['long-context', 'analysis', 'summarization']
    },
    'gemma-7b-it': {
      description: 'Gemma 7B instruction-tuned model',
      maxTokens: 8192,
      capabilities: ['instruction-following', 'conversation', 'analysis']
    }
  };

  return modelInfoMap[modelName] || {
    description: 'AI model for general-purpose inference',
    maxTokens: 4096,
    capabilities: ['text-generation']
  };
}

export default router;