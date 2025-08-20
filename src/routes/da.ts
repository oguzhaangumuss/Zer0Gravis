import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ZeroGDAService } from '../services/da/zeroGDAService';
import { logger } from '../utils/logger';
import { ValidationError, StorageError } from '../middleware/errorHandler';

const router = express.Router();
const daService = new ZeroGDAService();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/zerogravis/da-uploads',
  limits: {
    fileSize: 32 * 1024 * 1024 // 32MB limit for DA
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types for DA publishing
    cb(null, true);
  }
});

// Ensure upload directory exists
const uploadDir = '/tmp/zerogravis/da-uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * @swagger
 * components:
 *   schemas:
 *     DAPublishResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         blobId:
 *           type: string
 *         txHash:
 *           type: string
 *         blockNumber:
 *           type: number
 *         dataSize:
 *           type: number
 *         publishTime:
 *           type: string
 *           format: date-time
 *         error:
 *           type: string
 *     
 *     DARetrieveResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         blobId:
 *           type: string
 *         metadata:
 *           type: object
 *           properties:
 *             size:
 *               type: number
 *             blockNumber:
 *               type: number
 *             timestamp:
 *               type: string
 *               format: date-time
 *             verified:
 *               type: boolean
 *         error:
 *           type: string
 *     
 *     DABlobInfo:
 *       type: object
 *       properties:
 *         blobId:
 *           type: string
 *         size:
 *           type: number
 *         blockNumber:
 *           type: number
 *         timestamp:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [pending, confirmed, finalized, failed]
 *         txHash:
 *           type: string
 *     
 *     DANetworkStatus:
 *       type: object
 *       properties:
 *         client:
 *           type: object
 *         encoder:
 *           type: object
 *         retriever:
 *           type: object
 *         network:
 *           type: object
 *         limits:
 *           type: object
 *         status:
 *           type: string
 *           enum: [connected, partial, disconnected]
 */

/**
 * @swagger
 * /api/v1/da/publish:
 *   post:
 *     summary: Publish data to 0G Data Availability Layer
 *     tags: [Data Availability]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to publish to DA layer
 *               metadata:
 *                 type: string
 *                 description: Optional JSON metadata
 *     responses:
 *       200:
 *         description: Data published successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DAPublishResult'
 *       400:
 *         description: Invalid file or missing data
 *       413:
 *         description: File too large
 *       500:
 *         description: Publish failed
 */
router.post('/publish', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ValidationError('No file provided for DA publish');
    }

    // Parse metadata if provided
    let metadata: Record<string, any> = {};
    if (req.body.metadata) {
      try {
        metadata = JSON.parse(req.body.metadata);
      } catch (parseError) {
        throw new ValidationError('Invalid metadata format. Must be valid JSON');
      }
    }

    logger.info('DA publish request received', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      metadata,
      ip: req.ip
    });

    // Read file data
    const fileData = fs.readFileSync(req.file.path);

    // Publish to 0G DA
    const result = await daService.publishData(fileData, {
      ...metadata,
      originalFilename: req.file.originalname,
      mimetype: req.file.mimetype
    });

    // Clean up temporary file
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError: any) {
      logger.warn('Failed to cleanup uploaded file', {
        tempPath: req.file.path,
        error: cleanupError.message
      });
    }

    if (!result.success) {
      throw new StorageError(result.error || 'DA publish failed');
    }

    logger.info('Data published to 0G DA successfully', {
      blobId: result.blobId,
      txHash: result.txHash,
      originalName: req.file.originalname
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    // Clean up temp file on error
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    logger.error('DA publish failed', {
      error: error.message,
      originalName: req.file?.originalname,
      size: req.file?.size
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/publish-data:
 *   post:
 *     summary: Publish JSON data to 0G Data Availability Layer
 *     tags: [Data Availability]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - data
 *             properties:
 *               data:
 *                 type: object
 *                 description: JSON data to publish
 *               metadata:
 *                 type: object
 *                 description: Optional metadata
 *           example:
 *             data:
 *               dataType: "weather"
 *               source: "weather"
 *               value:
 *                 city: "London"
 *                 temperature: 15.5
 *                 humidity: 65
 *             metadata:
 *               publishedBy: "oracle_service"
 *               urgency: "normal"
 *     responses:
 *       200:
 *         description: Data published successfully
 *       400:
 *         description: Invalid data format
 *       500:
 *         description: Publish failed
 */
router.post('/publish-data', async (req, res, next) => {
  try {
    const { data, metadata } = req.body;

    if (!data) {
      throw new ValidationError('data field is required');
    }

    if (typeof data !== 'object') {
      throw new ValidationError('data must be an object');
    }

    logger.info('DA data publish request received', {
      dataType: data.dataType,
      dataSource: data.source,
      hasMetadata: !!metadata,
      ip: req.ip
    });

    // Convert data to buffer
    const dataString = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(dataString, 'utf-8');

    // Publish to 0G DA
    const result = await daService.publishData(buffer, metadata);

    if (!result.success) {
      throw new StorageError(result.error || 'DA data publish failed');
    }

    logger.info('Data published to 0G DA successfully', {
      blobId: result.blobId,
      dataType: data.dataType,
      dataSize: buffer.length
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA data publish failed', {
      error: error.message,
      dataType: req.body?.data?.dataType
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/publish-oracle:
 *   post:
 *     summary: Publish oracle data to 0G Data Availability Layer
 *     tags: [Data Availability]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oracleData
 *               - dataType
 *             properties:
 *               oracleData:
 *                 type: object
 *                 description: Oracle data to publish
 *               dataType:
 *                 type: string
 *                 description: Type of oracle data
 *           example:
 *             oracleData:
 *               source: "chainlink"
 *               dataType: "price_feed"
 *               value:
 *                 symbol: "ETH/USD"
 *                 price: 2500.50
 *               timestamp: 1703087400000
 *             dataType: "price_feed"
 *     responses:
 *       200:
 *         description: Oracle data published successfully
 *       400:
 *         description: Invalid oracle data format
 *       500:
 *         description: Publish failed
 */
router.post('/publish-oracle', async (req, res, next) => {
  try {
    const { oracleData, dataType } = req.body;

    if (!oracleData || !dataType) {
      throw new ValidationError('oracleData and dataType are required');
    }

    if (typeof oracleData !== 'object') {
      throw new ValidationError('oracleData must be an object');
    }

    if (typeof dataType !== 'string') {
      throw new ValidationError('dataType must be a string');
    }

    logger.info('DA oracle publish request received', {
      dataType,
      source: oracleData.source,
      oracleTimestamp: oracleData.timestamp,
      ip: req.ip
    });

    // Publish oracle data to 0G DA
    const result = await daService.publishOracleData(oracleData, dataType);

    if (!result.success) {
      throw new StorageError(result.error || 'Oracle data DA publish failed');
    }

    logger.info('Oracle data published to 0G DA successfully', {
      blobId: result.blobId,
      dataType,
      source: oracleData.source
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA oracle publish failed', {
      error: error.message,
      dataType: req.body?.dataType
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/retrieve/{blobId}:
 *   get:
 *     summary: Retrieve data from 0G Data Availability Layer
 *     tags: [Data Availability]
 *     parameters:
 *       - in: path
 *         name: blobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Blob ID to retrieve data for
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [binary, json, text]
 *           default: binary
 *         description: Response format
 *       - in: query
 *         name: download
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Force download as file
 *     responses:
 *       200:
 *         description: Data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DARetrieveResult'
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid blob ID format
 *       404:
 *         description: Blob not found
 *       500:
 *         description: Retrieval failed
 */
router.get('/retrieve/:blobId', async (req, res, next) => {
  try {
    const { blobId } = req.params;
    const format = (req.query.format as string) || 'binary';
    const download = req.query.download === 'true';

    // Validate blobId format
    if (!blobId || (!/^0x[a-fA-F0-9]{64}$/.test(blobId) && !/^[a-fA-F0-9]{64}$/.test(blobId))) {
      throw new ValidationError('Invalid blobId format. Must be 64-character hex string');
    }

    logger.info('DA retrieve request received', {
      blobId,
      format,
      download,
      ip: req.ip
    });

    // Retrieve from 0G DA
    const result = await daService.retrieveData(blobId);

    if (!result.success) {
      if (result.error?.includes('not found') || result.error?.includes('not available')) {
        return res.status(404).json({
          success: false,
          error: 'Blob not found or not available for retrieval',
          blobId: blobId,
          timestamp: new Date().toISOString()
        });
      }
      throw new StorageError(result.error || 'DA retrieval failed');
    }

    logger.info('Data retrieved from 0G DA successfully', {
      blobId,
      size: result.metadata?.size,
      verified: result.metadata?.verified
    });

    // Handle different response formats
    if (download || format === 'binary') {
      // Return as binary file download
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="blob-${blobId.slice(0, 8)}.bin"`);
      res.setHeader('Content-Length', result.data!.length.toString());
      res.setHeader('X-Blob-Id', blobId);
      res.setHeader('X-Verified', result.metadata?.verified ? 'true' : 'false');
      res.setHeader('X-Block-Number', result.metadata?.blockNumber?.toString() || '0');

      return res.send(result.data);
    }

    if (format === 'json') {
      // Try to parse as JSON
      try {
        const jsonData = JSON.parse(result.data!.toString('utf-8'));
        return res.json({
          success: true,
          blobId: blobId,
          data: jsonData,
          metadata: result.metadata,
          timestamp: new Date().toISOString()
        });
      } catch (jsonError) {
        throw new ValidationError('Blob data is not valid JSON');
      }
    }

    if (format === 'text') {
      // Return as text
      return res.json({
        success: true,
        blobId: blobId,
        data: result.data!.toString('utf-8'),
        metadata: result.metadata,
        timestamp: new Date().toISOString()
      });
    }

    // Default: return metadata with base64 data
    res.json({
      success: true,
      blobId: blobId,
      data: result.data!.toString('base64'),
      metadata: result.metadata,
      encoding: 'base64',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA retrieve failed', {
      blobId: req.params.blobId,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/retrieve-oracle/{blobId}:
 *   get:
 *     summary: Retrieve oracle data from 0G Data Availability Layer
 *     tags: [Data Availability]
 *     parameters:
 *       - in: path
 *         name: blobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Blob ID containing oracle data
 *     responses:
 *       200:
 *         description: Oracle data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Retrieved oracle data
 *       400:
 *         description: Invalid blob ID format
 *       404:
 *         description: Oracle data not found
 *       500:
 *         description: Retrieval failed
 */
router.get('/retrieve-oracle/:blobId', async (req, res, next) => {
  try {
    const { blobId } = req.params;

    // Validate blobId format
    if (!blobId || (!/^0x[a-fA-F0-9]{64}$/.test(blobId) && !/^[a-fA-F0-9]{64}$/.test(blobId))) {
      throw new ValidationError('Invalid blobId format');
    }

    logger.info('DA oracle retrieve request received', {
      blobId,
      ip: req.ip
    });

    // Retrieve oracle data from 0G DA
    const result = await daService.retrieveOracleData(blobId);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Oracle data not found',
          blobId: blobId,
          timestamp: new Date().toISOString()
        });
      }
      throw new StorageError(result.error || 'Oracle data retrieval failed');
    }

    logger.info('Oracle data retrieved from DA successfully', {
      blobId,
      dataType: result.data?.metadata?.dataType,
      source: result.data?.source
    });

    res.json({
      success: true,
      blobId: blobId,
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA oracle retrieve failed', {
      blobId: req.params.blobId,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/blob/{blobId}:
 *   get:
 *     summary: Get blob information from DA layer
 *     tags: [Data Availability]
 *     parameters:
 *       - in: path
 *         name: blobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Blob ID to get information for
 *     responses:
 *       200:
 *         description: Blob information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DABlobInfo'
 *       400:
 *         description: Invalid blob ID format
 *       404:
 *         description: Blob not found
 */
router.get('/blob/:blobId', async (req, res, next) => {
  try {
    const { blobId } = req.params;

    // Validate blobId format
    if (!blobId || (!/^0x[a-fA-F0-9]{64}$/.test(blobId) && !/^[a-fA-F0-9]{64}$/.test(blobId))) {
      throw new ValidationError('Invalid blobId format');
    }

    logger.info('DA blob info request received', {
      blobId,
      ip: req.ip
    });

    const blobInfo = await daService.getBlobInfo(blobId);

    if (!blobInfo) {
      return res.status(404).json({
        success: false,
        error: 'Blob not found',
        blobId: blobId,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: blobInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA blob info failed', {
      blobId: req.params.blobId,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/status:
 *   get:
 *     summary: Get 0G Data Availability Network status
 *     tags: [Data Availability]
 *     responses:
 *       200:
 *         description: DA network status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/DANetworkStatus'
 *       503:
 *         description: DA network connection failed
 */
router.get('/status', async (req, res, next) => {
  try {
    logger.info('DA status request received', { ip: req.ip });

    const networkStatus = await daService.getNetworkStatus();

    if (networkStatus.status === 'disconnected') {
      return res.status(503).json({
        success: false,
        data: networkStatus,
        error: 'DA network connection failed',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: networkStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA status check failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/limits:
 *   get:
 *     summary: Get DA layer limits and configuration
 *     tags: [Data Availability]
 *     responses:
 *       200:
 *         description: DA limits and configuration
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
 *                     maxBlobSize:
 *                       type: number
 *                       description: Maximum blob size in bytes
 *                     batchSizeLimit:
 *                       type: number
 *                       description: Maximum batch size
 *                     inclusionTimeout:
 *                       type: number
 *                       description: Inclusion timeout in milliseconds
 *                     supportedFormats:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get('/limits', async (req, res, next) => {
  try {
    logger.info('DA limits request received', { ip: req.ip });

    const networkStatus = await daService.getNetworkStatus();

    res.json({
      success: true,
      data: {
        ...networkStatus.limits,
        supportedFormats: ['binary', 'json', 'text'],
        endpoints: {
          client: networkStatus.client.endpoint,
          encoder: networkStatus.encoder.endpoint,
          retriever: networkStatus.retriever.endpoint
        },
        network: networkStatus.network
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA limits request failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/da/test:
 *   post:
 *     summary: Test DA layer with sample data
 *     tags: [Data Availability]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               testData:
 *                 type: string
 *                 default: "Hello 0G Data Availability!"
 *                 description: Test data to publish and retrieve
 *     responses:
 *       200:
 *         description: DA test completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: object
 *                   properties:
 *                     publish:
 *                       type: object
 *                     retrieve:
 *                       type: object
 *                     verified:
 *                       type: boolean
 *       500:
 *         description: DA test failed
 */
router.post('/test', async (req, res, next) => {
  try {
    const testData = req.body.testData || 'Hello 0G Data Availability!';
    const testBuffer = Buffer.from(testData, 'utf-8');

    logger.info('DA test requested', {
      testData,
      dataSize: testBuffer.length,
      ip: req.ip
    });

    // Step 1: Publish test data
    const publishResult = await daService.publishData(testBuffer, {
      test: true,
      timestamp: new Date().toISOString()
    });

    if (!publishResult.success) {
      throw new StorageError(`DA publish test failed: ${publishResult.error}`);
    }

    logger.info('DA test publish successful', {
      blobId: publishResult.blobId,
      txHash: publishResult.txHash
    });

    // Step 2: Wait a moment for propagation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Retrieve test data
    const retrieveResult = await daService.retrieveData(publishResult.blobId!);

    let verified = false;
    if (retrieveResult.success) {
      const retrievedData = retrieveResult.data!.toString('utf-8');
      verified = retrievedData === testData;
    }

    logger.info('DA test completed', {
      blobId: publishResult.blobId,
      publishSuccess: publishResult.success,
      retrieveSuccess: retrieveResult.success,
      verified
    });

    res.json({
      success: true,
      results: {
        publish: {
          success: publishResult.success,
          blobId: publishResult.blobId,
          txHash: publishResult.txHash,
          dataSize: publishResult.dataSize
        },
        retrieve: {
          success: retrieveResult.success,
          dataSize: retrieveResult.data?.length,
          verified: retrieveResult.metadata?.verified
        },
        verified: verified,
        roundTripTime: Date.now() - (publishResult.publishTime?.getTime() || Date.now())
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('DA test failed', {
      error: error.message
    });
    next(error);
  }
});

export default router;