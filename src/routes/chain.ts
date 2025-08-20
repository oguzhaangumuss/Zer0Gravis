import express from 'express';
import { ZeroGChainService, OracleData } from '../services/chain/zeroGChainService';
import { logger } from '../utils/logger';
import { ValidationError } from '../middleware/errorHandler';

const router = express.Router();
const chainService = new ZeroGChainService();

/**
 * @swagger
 * components:
 *   schemas:
 *     OracleData:
 *       type: object
 *       required:
 *         - source
 *         - dataType
 *         - value
 *       properties:
 *         source:
 *           type: string
 *           description: Oracle source identifier
 *         dataType:
 *           type: string
 *           description: Type of oracle data
 *         value:
 *           type: object
 *           description: Oracle data payload
 *         timestamp:
 *           type: number
 *           description: Timestamp of the data
 *         signature:
 *           type: string
 *           description: Optional data signature
 *     
 *     NetworkStatus:
 *       type: object
 *       properties:
 *         network:
 *           type: object
 *         block:
 *           type: object
 *         wallet:
 *           type: object
 *         gas:
 *           type: object
 *         status:
 *           type: string
 */

/**
 * @swagger
 * /api/v1/chain/submit:
 *   post:
 *     summary: Submit oracle data to 0G Chain
 *     tags: [Chain]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OracleData'
 *           example:
 *             source: "chainlink"
 *             dataType: "price_feed"
 *             value:
 *               symbol: "ETH/USD"
 *               price: 2500.50
 *               timestamp: 1703087400
 *             timestamp: 1703087400000
 *     responses:
 *       200:
 *         description: Oracle data successfully submitted to chain
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
 *                     dataHash:
 *                       type: string
 *                     transactionHash:
 *                       type: string
 *                     blockNumber:
 *                       type: number
 *                     gasUsed:
 *                       type: string
 *       400:
 *         description: Invalid oracle data format
 *       503:
 *         description: Chain submission failed
 */
router.post('/submit', async (req, res, next) => {
  try {
    const { source, dataType, value, timestamp, signature } = req.body;

    // Validate required fields
    if (!source || !dataType || !value) {
      throw new ValidationError('source, dataType, and value are required');
    }

    // Validate data types
    if (typeof source !== 'string' || typeof dataType !== 'string') {
      throw new ValidationError('source and dataType must be strings');
    }

    if (typeof value !== 'object') {
      throw new ValidationError('value must be an object');
    }

    logger.info('Chain submission request received', {
      source,
      dataType,
      timestamp: timestamp || Date.now(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const oracleData: OracleData = {
      source,
      dataType,
      value,
      timestamp: timestamp || Date.now(),
      signature
    };

    const result = await chainService.submitOracleData(oracleData);

    logger.info('Oracle data submitted to chain successfully', {
      dataHash: result.dataHash,
      transactionHash: result.transactionHash,
      blockNumber: result.blockNumber
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Chain submission failed', {
      error: error.message,
      requestBody: req.body
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/chain/verify/{dataHash}:
 *   get:
 *     summary: Verify oracle data on 0G Chain
 *     tags: [Chain]
 *     parameters:
 *       - in: path
 *         name: dataHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Hash of the oracle data to verify
 *     responses:
 *       200:
 *         description: Verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 verified:
 *                   type: boolean
 *                 dataHash:
 *                   type: string
 *       400:
 *         description: Invalid data hash format
 */
router.get('/verify/:dataHash', async (req, res, next) => {
  try {
    const { dataHash } = req.params;

    // Validate dataHash format (should be 0x prefixed hex string)
    if (!dataHash || !/^0x[a-fA-F0-9]{64}$/.test(dataHash)) {
      throw new ValidationError('Invalid dataHash format. Must be 0x prefixed 64-character hex string');
    }

    logger.info('Chain verification request received', {
      dataHash,
      ip: req.ip
    });

    const verified = await chainService.verifyOracleData(dataHash);

    res.json({
      success: true,
      verified: verified,
      dataHash: dataHash,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Chain verification failed', {
      dataHash: req.params.dataHash,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/chain/data/{dataHash}:
 *   get:
 *     summary: Retrieve oracle data from 0G Chain
 *     tags: [Chain]
 *     parameters:
 *       - in: path
 *         name: dataHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Hash of the oracle data to retrieve
 *     responses:
 *       200:
 *         description: Oracle data retrieved from chain
 *       404:
 *         description: Data not found on chain
 */
router.get('/data/:dataHash', async (req, res, next) => {
  try {
    const { dataHash } = req.params;

    // Validate dataHash format
    if (!dataHash || !/^0x[a-fA-F0-9]{64}$/.test(dataHash)) {
      throw new ValidationError('Invalid dataHash format. Must be 0x prefixed 64-character hex string');
    }

    logger.info('Chain data retrieval request received', {
      dataHash,
      ip: req.ip
    });

    const oracleData = await chainService.getOracleData(dataHash);

    if (!oracleData.exists) {
      return res.status(404).json({
        success: false,
        error: 'Oracle data not found on chain',
        dataHash: dataHash,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: oracleData,
      dataHash: dataHash,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Chain data retrieval failed', {
      dataHash: req.params.dataHash,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/chain/status:
 *   get:
 *     summary: Get 0G Chain network status
 *     tags: [Chain]
 *     responses:
 *       200:
 *         description: Network status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/NetworkStatus'
 *       503:
 *         description: Network connection failed
 */
router.get('/status', async (req, res, next) => {
  try {
    logger.info('Network status request received', {
      ip: req.ip
    });

    const networkStatus = await chainService.getNetworkStatus();

    if (networkStatus.status === 'disconnected') {
      return res.status(503).json({
        success: false,
        data: networkStatus,
        error: 'Network connection failed',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: networkStatus,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Network status check failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/chain/wallet:
 *   get:
 *     summary: Get wallet information
 *     tags: [Chain]
 *     responses:
 *       200:
 *         description: Wallet information
 */
router.get('/wallet', async (req, res, next) => {
  try {
    logger.info('Wallet info request received');

    const address = chainService.getSignerAddress();
    const balance = await chainService.getBalance();
    const blockNumber = await chainService.getCurrentBlockNumber();

    res.json({
      success: true,
      data: {
        address: address,
        balance: balance,
        balanceUnit: 'OG',
        currentBlock: blockNumber,
        network: '0G-Galileo-Testnet'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Wallet info retrieval failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/chain/estimate-gas:
 *   post:
 *     summary: Estimate gas cost for oracle data submission
 *     tags: [Chain]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OracleData'
 *     responses:
 *       200:
 *         description: Gas estimation result
 */
router.post('/estimate-gas', async (req, res, next) => {
  try {
    const oracleData = req.body;

    if (!oracleData || typeof oracleData !== 'object') {
      throw new ValidationError('Valid oracle data is required for gas estimation');
    }

    logger.info('Gas estimation request received', {
      dataType: oracleData.dataType,
      source: oracleData.source
    });

    const gasEstimate = await chainService.estimateGas(oracleData);

    res.json({
      success: true,
      data: {
        gasEstimate: gasEstimate.toString(),
        gasEstimateGwei: (Number(gasEstimate) / 1e9).toString(),
        currency: 'OG'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Gas estimation failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/chain/transaction/{txHash}:
 *   get:
 *     summary: Get transaction details
 *     tags: [Chain]
 *     parameters:
 *       - in: path
 *         name: txHash
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction hash
 *     responses:
 *       200:
 *         description: Transaction details
 *       404:
 *         description: Transaction not found
 */
router.get('/transaction/:txHash', async (req, res, next) => {
  try {
    const { txHash } = req.params;

    // Validate transaction hash format
    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new ValidationError('Invalid transaction hash format');
    }

    logger.info('Transaction details request received', {
      txHash,
      ip: req.ip
    });

    const receipt = await chainService.waitForTransaction(txHash);

    res.json({
      success: true,
      data: {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed?.toString(),
        status: receipt.status,
        from: receipt.from,
        to: receipt.to
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found',
        txHash: req.params.txHash,
        timestamp: new Date().toISOString()
      });
    }

    logger.error('Transaction details retrieval failed', {
      txHash: req.params.txHash,
      error: error.message
    });
    next(error);
  }
});

export default router;