import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ZeroGStorageService } from '../services/storage/zeroGStorageService';
import { logger } from '../utils/logger';
import { ValidationError, StorageError } from '../middleware/errorHandler';

const router = express.Router();
const storageService = new ZeroGStorageService();

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/zerogravis/uploads',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types for oracle data storage
    cb(null, true);
  }
});

// Ensure upload directory exists
const uploadDir = '/tmp/zerogravis/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * @swagger
 * components:
 *   schemas:
 *     StorageUploadResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         rootHash:
 *           type: string
 *         txHash:
 *           type: string
 *         size:
 *           type: number
 *         fileName:
 *           type: string
 *         uploadTime:
 *           type: string
 *           format: date-time
 *         error:
 *           type: string
 *     
 *     StorageDownloadResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         filePath:
 *           type: string
 *         size:
 *           type: number
 *         verified:
 *           type: boolean
 *         downloadTime:
 *           type: string
 *           format: date-time
 *         error:
 *           type: string
 *     
 *     StorageInfo:
 *       type: object
 *       properties:
 *         network:
 *           type: object
 *         indexer:
 *           type: object
 *         wallet:
 *           type: object
 *         flow:
 *           type: object
 *         config:
 *           type: object
 *         status:
 *           type: string
 */

/**
 * @swagger
 * /api/v1/storage/upload:
 *   post:
 *     summary: Upload file to 0G Storage Network
 *     tags: [Storage]
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
 *                 description: File to upload
 *               fileName:
 *                 type: string
 *                 description: Optional custom filename
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/StorageUploadResult'
 *       400:
 *         description: Invalid file or missing file
 *       413:
 *         description: File too large
 *       500:
 *         description: Upload failed
 */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ValidationError('No file provided for upload');
    }

    const customFileName = req.body.fileName || req.file.originalname;
    const walletAddress = req.body.walletAddress;

    logger.info('Storage upload request received', {
      originalName: req.file.originalname,
      fileName: customFileName,
      size: req.file.size,
      mimetype: req.file.mimetype,
      walletAddress: walletAddress,
      ip: req.ip
    });

    // Upload file to 0G Storage
    const result = await storageService.uploadFile(req.file.path, customFileName, walletAddress);

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
      throw new StorageError(result.error || 'Upload failed');
    }

    logger.info('File uploaded to 0G Storage successfully', {
      rootHash: result.rootHash,
      txHash: result.txHash,
      fileName: result.fileName
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

    logger.error('Storage upload failed', {
      error: error.message,
      originalName: req.file?.originalname,
      size: req.file?.size
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/upload-data:
 *   post:
 *     summary: Upload JSON data to 0G Storage Network
 *     tags: [Storage]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - data
 *               - fileName
 *             properties:
 *               data:
 *                 type: object
 *                 description: JSON data to store
 *               fileName:
 *                 type: string
 *                 description: Name for the data file
 *           example:
 *             data:
 *               dataType: "price_feed"
 *               source: "chainlink"
 *               value:
 *                 symbol: "ETH/USD"
 *                 price: 2500.50
 *             fileName: "eth-usd-price-20241220.json"
 *     responses:
 *       200:
 *         description: Data uploaded successfully
 *       400:
 *         description: Invalid data or missing parameters
 *       500:
 *         description: Upload failed
 */
router.post('/upload-data', async (req, res, next) => {
  try {
    const { data, fileName } = req.body;

    if (!data || !fileName) {
      throw new ValidationError('data and fileName are required');
    }

    if (typeof data !== 'object') {
      throw new ValidationError('data must be an object');
    }

    if (typeof fileName !== 'string' || fileName.trim().length === 0) {
      throw new ValidationError('fileName must be a non-empty string');
    }

    logger.info('Storage data upload request received', {
      fileName,
      dataType: data.dataType,
      dataSize: JSON.stringify(data).length,
      ip: req.ip
    });

    // Upload data to 0G Storage
    const result = await storageService.storeOracleData(data, fileName);

    if (!result.success) {
      throw new StorageError(result.error || 'Data upload failed');
    }

    logger.info('Data uploaded to 0G Storage successfully', {
      rootHash: result.rootHash,
      fileName: result.fileName
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Storage data upload failed', {
      error: error.message,
      fileName: req.body?.fileName
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/download/{rootHash}:
 *   get:
 *     summary: Download file from 0G Storage Network
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: rootHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Root hash of the file to download
 *       - in: query
 *         name: fileName
 *         schema:
 *           type: string
 *         description: Optional filename for the downloaded file
 *     responses:
 *       200:
 *         description: File downloaded successfully
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid root hash format
 *       404:
 *         description: File not found
 *       500:
 *         description: Download failed
 */
router.get('/download/:rootHash', async (req, res, next) => {
  try {
    const { rootHash } = req.params;
    const fileName = req.query.fileName as string || 'downloaded-file';

    // Validate rootHash format
    if (!rootHash || !/^0x[a-fA-F0-9]{64}$/.test(rootHash)) {
      throw new ValidationError('Invalid rootHash format. Must be 0x prefixed 64-character hex string');
    }

    logger.info('Storage download request received', {
      rootHash,
      fileName,
      ip: req.ip
    });

    // Create temporary download directory
    const downloadDir = '/tmp/zerogravis/downloads';
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const tempFilePath = path.join(downloadDir, `${Date.now()}_${fileName}`);

    // Download from 0G Storage
    const result = await storageService.downloadFile(rootHash, tempFilePath);

    if (!result.success) {
      throw new StorageError(result.error || 'Download failed');
    }

    // Check if file exists
    if (!fs.existsSync(tempFilePath)) {
      throw new StorageError('Downloaded file not found');
    }

    logger.info('File downloaded from 0G Storage successfully', {
      rootHash,
      size: result.size,
      verified: result.verified
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', result.size?.toString() || '0');
    res.setHeader('X-Root-Hash', rootHash);
    res.setHeader('X-Verified', result.verified ? 'true' : 'false');

    // Stream the file and cleanup
    const fileStream = fs.createReadStream(tempFilePath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      // Clean up temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError: any) {
        logger.warn('Failed to cleanup downloaded file', {
          tempFilePath,
          error: cleanupError.message
        });
      }
    });

    fileStream.on('error', (error) => {
      logger.error('File stream error', { error: error.message });
      next(error);
    });

  } catch (error: any) {
    logger.error('Storage download failed', {
      rootHash: req.params.rootHash,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/data/{rootHash}:
 *   get:
 *     summary: Retrieve JSON data from 0G Storage Network
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: rootHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Root hash of the data to retrieve
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
 *                   type: object
 *                   description: Retrieved oracle data
 *       400:
 *         description: Invalid root hash format
 *       404:
 *         description: Data not found
 *       500:
 *         description: Retrieval failed
 */
router.get('/data/:rootHash', async (req, res, next) => {
  try {
    const { rootHash } = req.params;

    // Validate rootHash format
    if (!rootHash || !/^0x[a-fA-F0-9]{64}$/.test(rootHash)) {
      throw new ValidationError('Invalid rootHash format. Must be 0x prefixed 64-character hex string');
    }

    logger.info('Storage data retrieval request received', {
      rootHash,
      ip: req.ip
    });

    // Retrieve oracle data from 0G Storage
    const result = await storageService.retrieveOracleData(rootHash);

    if (!result.success) {
      if (result.error?.includes('not found')) {
        return res.status(404).json({
          success: false,
          error: 'Data not found',
          rootHash: rootHash,
          timestamp: new Date().toISOString()
        });
      }
      throw new StorageError(result.error || 'Data retrieval failed');
    }

    logger.info('Data retrieved from 0G Storage successfully', {
      rootHash,
      dataType: result.data?.dataType,
      source: result.data?.source
    });

    res.json({
      success: true,
      data: result.data,
      rootHash: rootHash,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Storage data retrieval failed', {
      rootHash: req.params.rootHash,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/verify/{rootHash}:
 *   post:
 *     summary: Verify file integrity using merkle tree
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: rootHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Root hash to verify against
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
 *                 description: File to verify
 *     responses:
 *       200:
 *         description: Verification completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 verified:
 *                   type: boolean
 *                 rootHash:
 *                   type: string
 *                 localRootHash:
 *                   type: string
 *       400:
 *         description: Invalid parameters or missing file
 */
router.post('/verify/:rootHash', upload.single('file'), async (req, res, next) => {
  try {
    const { rootHash } = req.params;

    if (!req.file) {
      throw new ValidationError('No file provided for verification');
    }

    // Validate rootHash format
    if (!rootHash || !/^0x[a-fA-F0-9]{64}$/.test(rootHash)) {
      throw new ValidationError('Invalid rootHash format');
    }

    logger.info('Storage verification request received', {
      rootHash,
      fileName: req.file.originalname,
      size: req.file.size,
      ip: req.ip
    });

    // Verify file integrity
    const verified = await storageService.verifyFile(rootHash, req.file.path);

    // Clean up temporary file
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError: any) {
      logger.warn('Failed to cleanup verification file', {
        tempPath: req.file.path,
        error: cleanupError.message
      });
    }

    logger.info('File verification completed', {
      rootHash,
      verified,
      fileName: req.file.originalname
    });

    res.json({
      success: true,
      verified: verified,
      rootHash: rootHash,
      fileName: req.file.originalname,
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

    logger.error('Storage verification failed', {
      rootHash: req.params.rootHash,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/info:
 *   get:
 *     summary: Get 0G Storage Network information
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: Storage network information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/StorageInfo'
 *       503:
 *         description: Storage network connection failed
 */
router.get('/info', async (req, res, next) => {
  try {
    logger.info('Storage info request received', { ip: req.ip });

    const storageInfo = await storageService.getStorageInfo();

    if (storageInfo.status === 'disconnected') {
      return res.status(503).json({
        success: false,
        data: storageInfo,
        error: 'Storage network connection failed',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: storageInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Storage info retrieval failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/status/{rootHash}:
 *   get:
 *     summary: Get file status in storage network
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: rootHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Root hash of the file
 *     responses:
 *       200:
 *         description: File status information
 */
router.get('/status/:rootHash', async (req, res, next) => {
  try {
    const { rootHash } = req.params;

    // Validate rootHash format
    if (!rootHash || !/^0x[a-fA-F0-9]{64}$/.test(rootHash)) {
      throw new ValidationError('Invalid rootHash format');
    }

    logger.info('Storage status request received', {
      rootHash,
      ip: req.ip
    });

    const fileStatus = await storageService.getFileStatus(rootHash);

    res.json({
      success: true,
      data: fileStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Storage status check failed', {
      rootHash: req.params.rootHash,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/estimate-cost:
 *   post:
 *     summary: Estimate storage cost for file upload
 *     tags: [Storage]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fileSize
 *             properties:
 *               fileSize:
 *                 type: number
 *                 description: File size in bytes
 *           example:
 *             fileSize: 1048576
 *     responses:
 *       200:
 *         description: Cost estimation result
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
 *                     sizeCost:
 *                       type: string
 *                     totalCost:
 *                       type: string
 *                     fileSize:
 *                       type: number
 *                     currency:
 *                       type: string
 */
router.post('/estimate-cost', async (req, res, next) => {
  try {
    const { fileSize } = req.body;

    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
      throw new ValidationError('Valid fileSize (in bytes) is required');
    }

    if (fileSize > 100 * 1024 * 1024) { // 100MB limit
      throw new ValidationError('File size exceeds maximum limit of 100MB');
    }

    logger.info('Storage cost estimation request received', {
      fileSize,
      ip: req.ip
    });

    const costEstimate = await storageService.estimateUploadCost(fileSize);

    res.json({
      success: true,
      data: costEstimate,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Storage cost estimation failed', {
      fileSize: req.body?.fileSize,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/storage/test:
 *   get:
 *     summary: Test 0G Storage Network connection
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: Connection test successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 connected:
 *                   type: boolean
 *                 network:
 *                   type: string
 *       503:
 *         description: Connection test failed
 */
router.get('/test', async (req, res, next) => {
  try {
    logger.info('Storage connection test requested', { ip: req.ip });

    const connected = await storageService.testConnection();

    if (!connected) {
      return res.status(503).json({
        success: false,
        connected: false,
        error: 'Storage network connection test failed',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      connected: true,
      network: '0G-Galileo-Testnet',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Storage connection test failed', {
      error: error.message
    });
    next(error);
  }
});

export default router;