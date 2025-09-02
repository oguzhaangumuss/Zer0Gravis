import { ZgFile, Indexer, getFlowContract } from '@0glabs/0g-ts-sdk';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { StorageError } from '../../middleware/errorHandler';
import { walletService } from '../wallet/walletService';

export interface StorageUploadResult {
  success: boolean;
  rootHash?: string;
  txHash?: string;
  size?: number;
  fileName?: string;
  uploadTime?: Date;
  error?: string;
}

export interface StorageDownloadResult {
  success: boolean;
  filePath?: string;
  size?: number;
  verified?: boolean;
  downloadTime?: Date;
  error?: string;
}

export interface StorageFileInfo {
  rootHash: string;
  fileName: string;
  size: number;
  uploadTime: Date;
  verified: boolean;
  txHash: string;
}

export class ZeroGStorageService {
  private indexer: Indexer;
  private provider: ethers.Provider;
  private flowContract: any;

  constructor() {
    try {
      // Initialize provider for read operations
      this.provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);

      // Initialize indexer with 0G indexer endpoint
      this.indexer = new Indexer(config.zerog.storage.indexerRpc);

      logger.info('0G Storage Service initialized', {
        service: 'ZeroGravis',
        version: '1.0.0',
        indexerRpc: config.zerog.storage.indexerRpc,
        flowContract: config.zerog.storage.flowContract
      });

    } catch (error: any) {
      logger.error('Failed to initialize 0G Storage Service', {
        service: 'ZeroGravis',
        version: '1.0.0',
        error: error.message
      });
      throw new StorageError(`Storage service initialization failed: ${error.message}`);
    }
  }

  private async createSigner(walletAddress?: string): Promise<ethers.Wallet> {
    // For now, we'll use the backend signer as fallback
    // In production, transactions should be signed on frontend and sent as raw transactions
    const signer = walletService.createBackendSigner();
    
    if (walletAddress) {
      try {
        // Get wallet info to verify it exists and has balance
        const walletInfo = await walletService.getWalletInfo(walletAddress);
        
        logger.info('Creating signer for wallet operation', {
          requestedAddress: walletAddress,
          requestedBalance: walletInfo.balance,
          signerAddress: signer.address,
          note: 'Using backend signer as fallback - frontend should handle signing'
        });
        
        // Check if requested wallet has sufficient balance
        if (parseFloat(walletInfo.balance) < 0.001) { // 0.001 OG minimum
          logger.warn('Requested wallet has low balance', {
            requestedAddress: walletAddress,
            balance: walletInfo.balance
          });
        }
      } catch (error: any) {
        logger.warn('Failed to verify requested wallet, using backend signer', {
          requestedAddress: walletAddress,
          error: error.message
        });
      }
    } else {
      logger.info('No wallet address provided, using backend signer');
    }
    
    return signer;
  }

  private getFlowContract(signer: ethers.Wallet): any {
    if (!this.flowContract) {
      this.flowContract = getFlowContract(config.zerog.storage.flowContract, signer);
    }
    return this.flowContract;
  }

  async uploadFile(filePath: string, fileName?: string, walletAddress?: string): Promise<StorageUploadResult> {
    const startTime = Date.now();
    
    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Get file info
      const stats = fs.statSync(filePath);
      const actualFileName = fileName || path.basename(filePath);
      
      // Create signer for this operation
      const signer = await this.createSigner(walletAddress);
      
      logger.info('Starting file upload to 0G Storage', {
        filePath,
        fileName: actualFileName,
        size: stats.size,
        walletAddress: walletAddress || 'backend-default',
        signerAddress: signer.address
      });

      // Create ZgFile
      const file = await ZgFile.fromFilePath(filePath);

      // Generate merkle tree
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr) {
        throw new Error(`Merkle tree generation failed: ${treeErr}`);
      }

      const rootHash = tree?.rootHash();
      logger.info('Merkle tree generated', { rootHash });

      // Upload to 0G Storage Network using wallet-specific signer
      const [tx, uploadErr] = await this.indexer.upload(
        file,
        config.zerog.chain.rpc,
        signer
      );

      if (uploadErr) {
        throw new Error(`Upload failed: ${uploadErr}`);
      }

      logger.info('File uploaded successfully', {
        rootHash,
        txHash: tx,
        fileName: actualFileName,
        uploadTime: Date.now() - startTime
      });

      // Close file handle
      await file.close();

      return {
        success: true,
        rootHash: rootHash || undefined,
        txHash: tx,
        size: stats.size,
        fileName: actualFileName,
        uploadTime: new Date()
      };

    } catch (error: any) {
      logger.error('File upload failed', {
        filePath,
        fileName,
        error: error.message,
        uploadTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async uploadBuffer(buffer: Buffer, fileName: string, walletAddress?: string): Promise<StorageUploadResult> {
    const startTime = Date.now();
    
    try {
      // Create temporary file
      const tempDir = '/tmp/zerogravis';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, `${Date.now()}_${fileName}`);
      fs.writeFileSync(tempFilePath, buffer);

      logger.info('Starting buffer upload to 0G Storage', {
        fileName,
        size: buffer.length,
        tempFilePath
      });

      // Upload the temporary file with wallet address
      const result = await this.uploadFile(tempFilePath, fileName, walletAddress);

      // Clean up temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError: any) {
        logger.warn('Failed to cleanup temporary file', {
          tempFilePath,
          error: cleanupError.message
        });
      }

      return result;

    } catch (error: any) {
      logger.error('Buffer upload failed', {
        fileName,
        size: buffer.length,
        error: error.message,
        uploadTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async downloadFile(rootHash: string, outputPath: string): Promise<StorageDownloadResult> {
    const startTime = Date.now();
    
    try {
      // Validate rootHash format
      if (!rootHash || !/^0x[a-fA-F0-9]{64}$/.test(rootHash)) {
        throw new Error('Invalid rootHash format');
      }

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      logger.info('Starting file download from 0G Storage', {
        rootHash,
        outputPath
      });

      // Download from 0G Storage with verification
      const downloadErr = await this.indexer.download(
        rootHash,
        outputPath,
        true // withProof - enable verification
      );

      if (downloadErr) {
        throw new Error(`Download failed: ${downloadErr}`);
      }

      // Check if file was downloaded successfully
      if (!fs.existsSync(outputPath)) {
        throw new Error('File was not downloaded successfully');
      }

      const stats = fs.statSync(outputPath);
      
      logger.info('File downloaded successfully', {
        rootHash,
        outputPath,
        size: stats.size,
        downloadTime: Date.now() - startTime
      });

      return {
        success: true,
        filePath: outputPath,
        size: stats.size,
        verified: true,
        downloadTime: new Date()
      };

    } catch (error: any) {
      logger.error('File download failed', {
        rootHash,
        outputPath,
        error: error.message,
        downloadTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async downloadToBuffer(rootHash: string): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
    try {
      // Create temporary download path
      const tempDir = '/tmp/zerogravis/downloads';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, `${Date.now()}_${rootHash.slice(2, 10)}`);

      // Download to temporary file
      const downloadResult = await this.downloadFile(rootHash, tempFilePath);

      if (!downloadResult.success) {
        return {
          success: false,
          error: downloadResult.error
        };
      }

      // Read file to buffer
      const buffer = fs.readFileSync(tempFilePath);

      // Clean up temporary file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError: any) {
        logger.warn('Failed to cleanup temporary download file', {
          tempFilePath,
          error: cleanupError.message
        });
      }

      return {
        success: true,
        buffer: buffer
      };

    } catch (error: any) {
      logger.error('Download to buffer failed', {
        rootHash,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async verifyFile(rootHash: string, localFilePath: string): Promise<boolean> {
    try {
      logger.info('Verifying file integrity', {
        rootHash,
        localFilePath
      });

      // Create ZgFile from local file
      const file = await ZgFile.fromFilePath(localFilePath);
      
      // Generate merkle tree
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr) {
        throw new Error(`Merkle tree generation failed: ${treeErr}`);
      }

      const localRootHash = tree?.rootHash();
      
      // Close file handle
      await file.close();

      // Compare hashes
      const verified = localRootHash?.toLowerCase() === rootHash.toLowerCase();

      logger.info('File verification result', {
        rootHash,
        localRootHash,
        verified
      });

      return verified;

    } catch (error: any) {
      logger.error('File verification failed', {
        rootHash,
        localFilePath,
        error: error.message
      });
      return false;
    }
  }

  async getStorageInfo(walletAddress?: string): Promise<any> {
    try {
      // Get network information
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      // Create signer to get wallet info
      const signer = await this.createSigner(walletAddress);
      const balance = await this.provider.getBalance(signer.address);

      return {
        network: {
          chainId: network.chainId.toString(),
          name: '0G-Galileo-Testnet'
        },
        indexer: {
          rpcUrl: config.zerog.storage.indexerRpc,
          connected: true
        },
        wallet: {
          address: signer.address,
          requestedAddress: walletAddress,
          balance: ethers.formatEther(balance),
          balanceUnit: 'OG'
        },
        flow: {
          contractAddress: config.zerog.storage.flowContract,
          currentBlock: blockNumber
        },
        config: {
          replicationCount: config.zerog.storage.replicationCount,
          verificationEnabled: config.zerog.storage.verificationEnabled
        },
        status: 'connected',
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      logger.error('Failed to get storage info', {
        error: error.message
      });

      return {
        indexer: {
          rpcUrl: config.zerog.storage.indexerRpc,
          connected: false
        },
        status: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async testConnection(walletAddress?: string): Promise<boolean> {
    try {
      // Test provider connection
      const blockNumber = await this.provider.getBlockNumber();
      
      // Test signer balance
      const signer = await this.createSigner(walletAddress);
      const balance = await this.provider.getBalance(signer.address);
      
      logger.info('Storage connection test successful', {
        blockNumber,
        walletAddress,
        signerAddress: signer.address,
        balance: ethers.formatEther(balance)
      });

      return true;

    } catch (error: any) {
      logger.error('Storage connection test failed', {
        walletAddress,
        error: error.message
      });
      return false;
    }
  }

  // Utility methods
  async estimateUploadCost(fileSize: number): Promise<any> {
    try {
      // Estimate cost based on file size
      // This is a simplified estimation - real implementation would query the network
      const baseCost = BigInt('1000000000000000'); // 0.001 OG base cost
      const sizeCost = BigInt(fileSize) * BigInt('1000000000'); // per byte cost
      const totalCost = baseCost + sizeCost;

      return {
        baseCost: ethers.formatEther(baseCost),
        sizeCost: ethers.formatEther(sizeCost),
        totalCost: ethers.formatEther(totalCost),
        fileSize: fileSize,
        currency: 'OG'
      };

    } catch (error: any) {
      throw new StorageError(`Cost estimation failed: ${error.message}`);
    }
  }

  async getFileStatus(rootHash: string): Promise<any> {
    try {
      // Check if file exists in storage network
      // This is a simplified check - real implementation would query storage nodes
      return {
        rootHash: rootHash,
        exists: true, // Simulated
        replicated: config.zerog.storage.replicationCount,
        verified: true,
        lastAccessed: new Date(),
        status: 'available'
      };

    } catch (error: any) {
      return {
        rootHash: rootHash,
        exists: false,
        status: 'not_found',
        error: error.message
      };
    }
  }

  // Oracle data specific methods
  async storeOracleData(oracleData: any, fileName: string, walletAddress?: string): Promise<StorageUploadResult> {
    try {
      // Serialize oracle data to JSON
      const dataString = JSON.stringify(oracleData, null, 2);
      const buffer = Buffer.from(dataString, 'utf-8');

      logger.info('Storing oracle data to 0G Storage', {
        fileName,
        dataSize: buffer.length,
        oracleType: oracleData.dataType,
        oracleSource: oracleData.source
      });

      // Upload buffer to storage with wallet address
      const result = await this.uploadBuffer(buffer, fileName, walletAddress);

      if (result.success) {
        logger.info('Oracle data stored successfully', {
          rootHash: result.rootHash,
          fileName,
          txHash: result.txHash
        });
      }

      return result;

    } catch (error: any) {
      logger.error('Oracle data storage failed', {
        fileName,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async retrieveOracleData(rootHash: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      logger.info('Retrieving oracle data from 0G Storage', { rootHash });

      // Download to buffer
      const downloadResult = await this.downloadToBuffer(rootHash);

      if (!downloadResult.success) {
        return {
          success: false,
          error: downloadResult.error
        };
      }

      // Parse JSON data
      const dataString = downloadResult.buffer!.toString('utf-8');
      const oracleData = JSON.parse(dataString);

      logger.info('Oracle data retrieved successfully', {
        rootHash,
        dataType: oracleData.dataType,
        source: oracleData.source
      });

      return {
        success: true,
        data: oracleData
      };

    } catch (error: any) {
      logger.error('Oracle data retrieval failed', {
        rootHash,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
}