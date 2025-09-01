import { Router } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import { transactionLogger } from '../services/transactionLogger';

const router = Router();

// Simple in-memory cache for transactions
let transactionCache = {
  data: null as any,
  lastUpdate: 0,
  cacheTimeout: 30000 // 30 seconds
};

/**
 * @swagger
 * /api/v1/transactions/recent:
 *   get:
 *     summary: Get recent transactions from the wallet address
 *     tags: [Transactions]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of transactions to retrieve
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, oracle, storage, compute, da]
 *         description: Filter transactions by type
 *     responses:
 *       200:
 *         description: Recent transactions retrieved successfully
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
 *                     transactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           hash:
 *                             type: string
 *                           blockNumber:
 *                             type: number
 *                           timestamp:
 *                             type: string
 *                           from:
 *                             type: string
 *                           to:
 *                             type: string
 *                           value:
 *                             type: string
 *                           gasUsed:
 *                             type: string
 *                           gasPrice:
 *                             type: string
 *                           status:
 *                             type: string
 *                           type:
 *                             type: string
 *                           description:
 *                             type: string
 *                     totalCount:
 *                       type: number
 *                     walletAddress:
 *                       type: string
 *       500:
 *         description: Server error
 */
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const typeFilter = req.query.type as string || 'all';
    
    // Check cache first
    const now = Date.now();
    if (transactionCache.data && (now - transactionCache.lastUpdate) < transactionCache.cacheTimeout) {
      return res.json({
        ...transactionCache.data,
        cached: true,
        timestamp: new Date().toISOString()
      });
    }
    
    const provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
    const walletAddress = config.zerog.chain.privateKey ? 
      new ethers.Wallet(config.zerog.chain.privateKey, provider).address : 
      null;

    if (!walletAddress) {
      return res.status(500).json({
        success: false,
        error: 'Wallet address not available'
      });
    }

    // Get real Oracle transactions from transaction logger
    const loggedTransactions = transactionLogger.getRecentTransactions(limit, typeFilter);
    
    // Convert logged transactions to expected format
    const transactions = loggedTransactions.map(tx => ({
      id: tx.id,
      hash: tx.hash,
      type: tx.type,
      status: tx.status,
      timestamp: tx.timestamp,
      value: `${tx.value} ETH`,
      gasUsed: tx.gasUsed,
      blockNumber: tx.blockNumber,
      from: tx.from,
      to: tx.to,
      description: tx.description,
      nonce: 0, // Not tracked in logger
      transactionIndex: 0 // Not tracked in logger
    }));

    // Initialize default values
    let latestBlockNumber = 0;
    let blocksToSearch = 0;

    // If no logged transactions, also check blockchain for any wallet transactions
    if (transactions.length === 0) {
      const blockchainProvider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
      latestBlockNumber = await blockchainProvider.getBlockNumber();
      const blockTransactions = [];

      // Search through recent blocks for transactions involving our wallet
      blocksToSearch = Math.min(20, latestBlockNumber);
      for (let i = 0; i < blocksToSearch && blockTransactions.length < limit; i++) {
        const blockNumber = latestBlockNumber - i;
        
        try {
          const block = await blockchainProvider.getBlock(blockNumber, true);
          if (!block || !block.transactions) continue;

          for (const txResponse of block.transactions) {
            if (blockTransactions.length >= limit) break;
            
            // Cast txResponse to proper type since it comes from ethers block.transactions array
            const txData = txResponse as any;
            const tx = {
              hash: txData.hash,
              from: txData.from,
              to: txData.to,
              value: txData.value,
              data: txData.data,
              gasLimit: txData.gasLimit,
              gasPrice: txData.gasPrice,
              nonce: txData.nonce,
              index: txData.index
            };
            
            // Check if transaction involves our wallet
            if (tx.from === walletAddress || tx.to === walletAddress) {
              // Skip receipt call to make it faster - determine status from block inclusion
              const isConfirmed = block.number > 0;
            
              // Determine transaction type and description based on recipient
              let txType = 'Transfer';
              let description = 'ETH transfer transaction';
              
              if (tx.to === config.zerog.dataAvailability.entranceContract) {
                txType = 'Oracle Data Recording';
                description = 'Oracle data recorded to 0G DA layer';
              } else if (tx.to === config.zerog.storage.flowContract) {
                txType = 'Storage Upload';
                description = 'Data stored on 0G Storage network';
              } else if (tx.to === config.zerog.compute.contract) {
                txType = 'AI Inference';
                description = 'AI model execution on 0G Compute network';
              } else if (tx.data && tx.data !== '0x') {
                txType = 'Contract Interaction';
                description = 'Smart contract interaction';
              }

              // Apply type filter
              if (typeFilter !== 'all') {
                const typeMatch = (typeFilter === 'oracle' && txType.includes('Oracle')) ||
                                (typeFilter === 'storage' && txType.includes('Storage')) ||
                                (typeFilter === 'compute' && txType.includes('AI')) ||
                                (typeFilter === 'da' && txType.includes('DA'));
                if (!typeMatch) continue;
              }

              blockTransactions.push({
                id: tx.hash.slice(0, 10),
                hash: tx.hash,
                blockNumber: block.number,
                timestamp: new Date(block.timestamp * 1000).toISOString(),
                from: tx.from,
                to: tx.to || '',
                value: `${ethers.formatEther(tx.value)} ETH`,
                gasUsed: tx.gasLimit.toString(), // Use gasLimit instead of gasUsed for speed
                gasPrice: tx.gasPrice?.toString() || '0',
                status: isConfirmed ? 'confirmed' as const : 'pending' as const,
                type: txType,
                description: description,
                nonce: tx.nonce,
                transactionIndex: tx.index || 0
              });
            }
          }
        } catch (error) {
          // Continue to next block if this one fails
          logger.warn(`Error fetching block ${blockNumber}:`, error);
          continue;
        }
      }
      
      // Add blockchain transactions if no logged ones
      transactions.push(...blockTransactions);
    }

    // Sort by block number (most recent first)
    transactions.sort((a, b) => b.blockNumber - a.blockNumber);

    const responseData = {
      success: true,
      data: {
        transactions,
        totalCount: transactions.length,
        walletAddress,
        searchedBlocks: blocksToSearch,
        latestBlock: latestBlockNumber
      },
      timestamp: new Date().toISOString()
    };

    // Cache the result
    transactionCache.data = responseData;
    transactionCache.lastUpdate = now;

    res.json(responseData);

  } catch (error) {
    logger.error('Error fetching recent transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent transactions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/v1/transactions/stats:
 *   get:
 *     summary: Get transaction statistics
 *     tags: [Transactions]
 *     responses:
 *       200:
 *         description: Transaction statistics retrieved successfully
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
 *                     totalTransactions:
 *                       type: number
 *                     oracleTransactions:
 *                       type: number
 *                     storageTransactions:
 *                       type: number
 *                     computeTransactions:
 *                       type: number
 *                     totalGasUsed:
 *                       type: string
 *                     totalValueTransferred:
 *                       type: string
 */
router.get('/stats', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
    const walletAddress = config.zerog.chain.privateKey ? 
      new ethers.Wallet(config.zerog.chain.privateKey, provider).address : 
      null;

    if (!walletAddress) {
      return res.status(500).json({
        success: false,
        error: 'Wallet address not available'
      });
    }

    // Get real transaction stats from transaction logger
    const stats = transactionLogger.getTransactionStats();

    res.json({
      success: true,
      data: stats,
      walletAddress,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error fetching transaction stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/v1/transactions/{hash}:
 *   get:
 *     summary: Get transaction details by hash
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: hash
 *         required: true
 *         schema:
 *           type: string
 *         description: Transaction hash
 *     responses:
 *       200:
 *         description: Transaction details retrieved successfully
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */
router.get('/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    
    if (!hash || !hash.match(/^0x[a-fA-F0-9]{64}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transaction hash format'
      });
    }

    const provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
    
    const [transaction, receipt] = await Promise.all([
      provider.getTransaction(hash),
      provider.getTransactionReceipt(hash)
    ]);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    const block = await provider.getBlock(transaction.blockNumber!);

    res.json({
      success: true,
      data: {
        hash: transaction.hash,
        blockNumber: transaction.blockNumber,
        blockHash: transaction.blockHash,
        transactionIndex: transaction.index,
        timestamp: block ? new Date(block.timestamp * 1000).toISOString() : null,
        from: transaction.from,
        to: transaction.to,
        value: ethers.formatEther(transaction.value),
        gasLimit: transaction.gasLimit.toString(),
        gasUsed: receipt?.gasUsed?.toString(),
        gasPrice: transaction.gasPrice?.toString(),
        nonce: transaction.nonce,
        data: transaction.data,
        status: receipt?.status === 1 ? 'success' : receipt?.status === 0 ? 'failed' : 'pending',
        logs: receipt?.logs || []
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error fetching transaction details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction details',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;