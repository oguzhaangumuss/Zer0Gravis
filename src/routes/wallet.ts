import express from 'express';
import { walletService } from '../services/wallet/walletService';
import { logger } from '../utils/logger';
import { ValidationError } from '../middleware/errorHandler';
import { ethers } from 'ethers';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     WalletInfo:
 *       type: object
 *       properties:
 *         address:
 *           type: string
 *         balance:
 *           type: string
 *         balanceWei:
 *           type: string
 *         nonce:
 *           type: number
 *         isContract:
 *           type: boolean
 *     
 *     TransactionPreparation:
 *       type: object
 *       properties:
 *         to:
 *           type: string
 *         value:
 *           type: string
 *         data:
 *           type: string
 *         gasLimit:
 *           type: string
 *         maxFeePerGas:
 *           type: string
 *         maxPriorityFeePerGas:
 *           type: string
 *         nonce:
 *           type: number
 *         chainId:
 *           type: number
 */

/**
 * @swagger
 * /api/v1/wallet/info/{address}:
 *   get:
 *     summary: Get wallet information
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address to get info for
 *     responses:
 *       200:
 *         description: Wallet information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/WalletInfo'
 *       400:
 *         description: Invalid wallet address
 */
router.get('/info/:address', async (req, res, next) => {
  try {
    const { address } = req.params;

    // Validate address format
    if (!address || !ethers.isAddress(address)) {
      throw new ValidationError('Invalid wallet address format');
    }

    logger.info('Wallet info request received', {
      address,
      ip: req.ip
    });

    const walletInfo = await walletService.getWalletInfo(address);

    res.json({
      success: true,
      data: {
        ...walletInfo,
        balanceWei: walletInfo.balanceWei.toString() // Convert BigInt to string for JSON
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Wallet info request failed', {
      address: req.params.address,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/wallet/prepare-transaction:
 *   post:
 *     summary: Prepare transaction for signing
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *             properties:
 *               from:
 *                 type: string
 *                 description: Sender wallet address
 *               to:
 *                 type: string
 *                 description: Recipient address
 *               value:
 *                 type: string
 *                 description: Amount to send (in wei)
 *               data:
 *                 type: string
 *                 description: Transaction data
 *     responses:
 *       200:
 *         description: Transaction prepared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/TransactionPreparation'
 */
router.post('/prepare-transaction', async (req, res, next) => {
  try {
    const { from, to, value, data } = req.body;

    // Validate addresses
    if (!from || !ethers.isAddress(from)) {
      throw new ValidationError('Invalid from address');
    }
    if (!to || !ethers.isAddress(to)) {
      throw new ValidationError('Invalid to address');
    }

    logger.info('Transaction preparation request received', {
      from,
      to,
      value,
      hasData: !!data,
      ip: req.ip
    });

    const transaction = {
      to,
      value: value ? BigInt(value) : undefined,
      data
    };

    const preparedTx = await walletService.prepareTransaction(from, transaction);

    res.json({
      success: true,
      data: preparedTx,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Transaction preparation failed', {
      from: req.body?.from,
      to: req.body?.to,
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/wallet/broadcast:
 *   post:
 *     summary: Broadcast signed transaction
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedTransaction
 *             properties:
 *               signedTransaction:
 *                 type: string
 *                 description: Signed transaction hex string
 *     responses:
 *       200:
 *         description: Transaction broadcasted successfully
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
 *                     hash:
 *                       type: string
 *                     receipt:
 *                       type: object
 */
router.post('/broadcast', async (req, res, next) => {
  try {
    const { signedTransaction } = req.body;

    if (!signedTransaction || typeof signedTransaction !== 'string') {
      throw new ValidationError('signedTransaction is required and must be a string');
    }

    if (!signedTransaction.startsWith('0x')) {
      throw new ValidationError('signedTransaction must be a hex string starting with 0x');
    }

    logger.info('Transaction broadcast request received', {
      signedTxLength: signedTransaction.length,
      ip: req.ip
    });

    const result = await walletService.broadcastTransaction(signedTransaction);

    res.json({
      success: true,
      data: {
        hash: result.hash,
        receipt: result.receipt ? {
          blockNumber: result.receipt.blockNumber,
          gasUsed: result.receipt.gasUsed.toString(),
          status: result.receipt.status,
          transactionHash: result.receipt.hash
        } : null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Transaction broadcast failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/wallet/gas-price:
 *   get:
 *     summary: Get current gas prices
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Gas prices retrieved successfully
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
 *                     gasPrice:
 *                       type: string
 *                     maxFeePerGas:
 *                       type: string
 *                     maxPriorityFeePerGas:
 *                       type: string
 */
router.get('/gas-price', async (req, res, next) => {
  try {
    logger.info('Gas price request received', { ip: req.ip });

    const gasPrice = await walletService.getGasPrice();

    res.json({
      success: true,
      data: {
        gasPrice: gasPrice.gasPrice.toString(),
        maxFeePerGas: gasPrice.maxFeePerGas.toString(),
        maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas.toString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Gas price request failed', {
      error: error.message
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/wallet/network:
 *   get:
 *     summary: Get network information
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Network information retrieved successfully
 */
router.get('/network', async (req, res, next) => {
  try {
    logger.info('Network info request received', { ip: req.ip });

    const networkInfo = await walletService.getNetworkInfo();

    res.json({
      success: true,
      data: networkInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Network info request failed', {
      error: error.message
    });
    next(error);
  }
});

export default router;