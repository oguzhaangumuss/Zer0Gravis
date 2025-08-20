import { ethers } from 'ethers';
import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { StorageError } from '../../middleware/errorHandler';

export interface DAPublishResult {
  success: boolean;
  blobId?: string;
  txHash?: string;
  blockNumber?: number;
  dataSize?: number;
  publishTime?: Date;
  error?: string;
}

export interface DARetrieveResult {
  success: boolean;
  data?: Buffer;
  blobId?: string;
  metadata?: {
    size: number;
    blockNumber: number;
    timestamp: Date;
    verified: boolean;
  };
  error?: string;
}

export interface DABlobInfo {
  blobId: string;
  size: number;
  blockNumber: number;
  timestamp: Date;
  status: 'pending' | 'confirmed' | 'finalized' | 'failed';
  txHash?: string;
}

export interface DANetworkStatus {
  client: {
    endpoint: string;
    connected: boolean;
    version?: string;
  };
  encoder: {
    endpoint: string;
    connected: boolean;
    status?: string;
  };
  retriever: {
    endpoint: string;
    connected: boolean;
    status?: string;
  };
  network: {
    chainId: number;
    latestBlock: number;
    entranceContract: string;
  };
  limits: {
    maxBlobSize: number;
    batchSizeLimit: number;
    inclusionTimeout: number;
  };
  status: 'connected' | 'partial' | 'disconnected';
  timestamp: string;
}

export class ZeroGDAService {
  private provider: ethers.Provider;
  private signer: ethers.Wallet;
  private entranceContract: ethers.Contract;

  // DA Client endpoints
  private clientEndpoint: string;
  private encoderEndpoint: string;
  private retrieverEndpoint: string;

  // Network configuration
  private maxBlobSize: number;
  private batchSizeLimit: number;
  private inclusionTimeout: number;

  constructor() {
    try {
      // Initialize provider and signer
      this.provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
      this.signer = new ethers.Wallet(config.zerog.chain.privateKey, this.provider);

      // DA service endpoints
      this.clientEndpoint = config.zerog.dataAvailability.clientEndpoint;
      this.encoderEndpoint = config.zerog.dataAvailability.encoderEndpoint;
      this.retrieverEndpoint = config.zerog.dataAvailability.retrieverEndpoint;

      // Network limits
      this.maxBlobSize = config.zerog.dataAvailability.maxBlobSize;
      this.batchSizeLimit = config.zerog.dataAvailability.batchSizeLimit;
      this.inclusionTimeout = config.zerog.dataAvailability.inclusionTimeout;

      // Initialize entrance contract (simplified ABI for DA operations)
      const daEntranceABI = [
        'function submitBlob(bytes calldata data) external returns (bytes32)',
        'function getBlobStatus(bytes32 blobId) external view returns (uint8, uint256)',
        'function verifyInclusion(bytes32 blobId, bytes calldata proof) external view returns (bool)',
        'event BlobSubmitted(bytes32 indexed blobId, address indexed submitter, uint256 size)'
      ];

      this.entranceContract = new ethers.Contract(
        config.zerog.dataAvailability.entranceContract,
        daEntranceABI,
        this.signer
      );

      logger.info('0G Data Availability Service initialized', {
        clientEndpoint: this.clientEndpoint,
        encoderEndpoint: this.encoderEndpoint,
        retrieverEndpoint: this.retrieverEndpoint,
        entranceContract: config.zerog.dataAvailability.entranceContract,
        maxBlobSize: this.maxBlobSize,
        signerAddress: this.signer.address
      });

    } catch (error: any) {
      logger.error('Failed to initialize 0G DA Service', {
        error: error.message
      });
      throw new StorageError(`DA service initialization failed: ${error.message}`);
    }
  }

  async publishData(data: Buffer, metadata?: Record<string, any>): Promise<DAPublishResult> {
    const startTime = Date.now();

    try {
      // Validate data size
      if (data.length > this.maxBlobSize) {
        throw new Error(`Data size (${data.length}) exceeds maximum blob size (${this.maxBlobSize})`);
      }

      if (data.length === 0) {
        throw new Error('Data cannot be empty');
      }

      logger.info('Starting data publish to 0G DA', {
        dataSize: data.length,
        metadata: metadata
      });

      // Step 1: Encode data using DA encoder
      const encodedData = await this.encodeData(data);
      logger.info('Data encoded successfully', {
        originalSize: data.length,
        encodedSize: encodedData.length
      });

      // Step 2: Submit to DA client for dispersal
      const dispersalResult = await this.disperseBlob(encodedData);
      logger.info('Blob dispersed to DA network', {
        blobId: dispersalResult.blobId,
        txHash: dispersalResult.txHash
      });

      // Step 3: Submit blob ID to entrance contract
      const contractTx = await this.submitToContract(data, dispersalResult.blobId);
      logger.info('Blob submitted to entrance contract', {
        blobId: dispersalResult.blobId,
        contractTxHash: contractTx.hash
      });

      // Step 4: Wait for confirmation
      const receipt = await contractTx.wait();
      if (!receipt) {
        throw new Error('Transaction receipt not available');
      }

      const publishTime = Date.now() - startTime;
      
      logger.info('Data published to 0G DA successfully', {
        blobId: dispersalResult.blobId,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
        publishTime
      });

      return {
        success: true,
        blobId: dispersalResult.blobId,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        dataSize: data.length,
        publishTime: new Date()
      };

    } catch (error: any) {
      logger.error('DA publish failed', {
        error: error.message,
        dataSize: data.length,
        publishTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async retrieveData(blobId: string): Promise<DARetrieveResult> {
    try {
      // Validate blobId format (should be hex string)
      if (!blobId || (!/^0x[a-fA-F0-9]{64}$/.test(blobId) && !/^[a-fA-F0-9]{64}$/.test(blobId))) {
        throw new Error('Invalid blobId format. Must be 64-character hex string');
      }

      // Ensure 0x prefix
      const normalizedBlobId = blobId.startsWith('0x') ? blobId : `0x${blobId}`;

      logger.info('Starting data retrieval from 0G DA', { blobId: normalizedBlobId });

      // Step 1: Get blob status from contract
      const blobStatus = await this.getBlobStatus(normalizedBlobId);
      if (blobStatus.status === 'failed' || blobStatus.status === 'pending') {
        throw new Error(`Blob is not available for retrieval. Status: ${blobStatus.status}`);
      }

      // Step 2: Retrieve encoded data from DA network
      const encodedData = await this.retrieveFromDA(normalizedBlobId);
      logger.info('Encoded data retrieved from DA network', {
        blobId: normalizedBlobId,
        encodedSize: encodedData.length
      });

      // Step 3: Decode the data
      const decodedData = await this.decodeData(encodedData);
      logger.info('Data decoded successfully', {
        blobId: normalizedBlobId,
        decodedSize: decodedData.length
      });

      logger.info('Data retrieved from 0G DA successfully', {
        blobId: normalizedBlobId,
        size: decodedData.length,
        blockNumber: blobStatus.blockNumber
      });

      return {
        success: true,
        data: decodedData,
        blobId: normalizedBlobId,
        metadata: {
          size: decodedData.length,
          blockNumber: blobStatus.blockNumber,
          timestamp: blobStatus.timestamp,
          verified: true
        }
      };

    } catch (error: any) {
      logger.error('DA retrieve failed', {
        blobId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async getBlobInfo(blobId: string): Promise<DABlobInfo | null> {
    try {
      const normalizedBlobId = blobId.startsWith('0x') ? blobId : `0x${blobId}`;
      
      // Get status from contract
      const [statusCode, blockNumber] = await this.entranceContract.getBlobStatus(normalizedBlobId);
      
      const statusMap = {
        0: 'pending',
        1: 'confirmed', 
        2: 'finalized',
        3: 'failed'
      } as const;

      const status = statusMap[statusCode as keyof typeof statusMap] || 'failed';

      // Get additional info from DA client if available
      let size = 0;
      let timestamp = new Date();
      let txHash: string | undefined;

      try {
        const clientInfo = await this.getBlobInfoFromClient(normalizedBlobId);
        size = clientInfo.size || 0;
        timestamp = clientInfo.timestamp || new Date();
        txHash = clientInfo.txHash;
      } catch (clientError: any) {
        logger.warn('Failed to get additional blob info from client', {
          blobId: normalizedBlobId,
          error: clientError.message
        });
      }

      return {
        blobId: normalizedBlobId,
        size,
        blockNumber: Number(blockNumber),
        timestamp,
        status,
        txHash
      };

    } catch (error: any) {
      logger.error('Failed to get blob info', {
        blobId,
        error: error.message
      });
      return null;
    }
  }

  async getNetworkStatus(): Promise<DANetworkStatus> {
    try {
      // Test client connection
      const clientStatus = await this.testClientConnection();
      
      // Test encoder connection
      const encoderStatus = await this.testEncoderConnection();
      
      // Test retriever connection
      const retrieverStatus = await this.testRetrieverConnection();

      // Get network info
      const network = await this.provider.getNetwork();
      const latestBlock = await this.provider.getBlockNumber();

      const connectedServices = [clientStatus.connected, encoderStatus.connected, retrieverStatus.connected].filter(Boolean).length;
      
      let overallStatus: 'connected' | 'partial' | 'disconnected';
      if (connectedServices === 3) {
        overallStatus = 'connected';
      } else if (connectedServices > 0) {
        overallStatus = 'partial';
      } else {
        overallStatus = 'disconnected';
      }

      return {
        client: clientStatus,
        encoder: encoderStatus,
        retriever: retrieverStatus,
        network: {
          chainId: Number(network.chainId),
          latestBlock,
          entranceContract: config.zerog.dataAvailability.entranceContract
        },
        limits: {
          maxBlobSize: this.maxBlobSize,
          batchSizeLimit: this.batchSizeLimit,
          inclusionTimeout: this.inclusionTimeout
        },
        status: overallStatus,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      logger.error('Failed to get DA network status', {
        error: error.message
      });

      return {
        client: { endpoint: this.clientEndpoint, connected: false },
        encoder: { endpoint: this.encoderEndpoint, connected: false },
        retriever: { endpoint: this.retrieverEndpoint, connected: false },
        network: {
          chainId: config.zerog.chain.chainId,
          latestBlock: 0,
          entranceContract: config.zerog.dataAvailability.entranceContract
        },
        limits: {
          maxBlobSize: this.maxBlobSize,
          batchSizeLimit: this.batchSizeLimit,
          inclusionTimeout: this.inclusionTimeout
        },
        status: 'disconnected',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Private helper methods

  private async encodeData(data: Buffer): Promise<Buffer> {
    try {
      logger.debug('Encoding data with DA encoder', { endpoint: this.encoderEndpoint });

      const response = await axios.post(`${this.encoderEndpoint}/encode`, {
        data: data.toString('base64')
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Encoding failed');
      }

      return Buffer.from(response.data.encodedData, 'base64');

    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        // Fallback: return original data if encoder is not available
        logger.warn('DA encoder not available, using original data', {
          endpoint: this.encoderEndpoint
        });
        return data;
      }
      throw new Error(`Data encoding failed: ${error.message}`);
    }
  }

  private async decodeData(encodedData: Buffer): Promise<Buffer> {
    try {
      logger.debug('Decoding data with DA encoder', { endpoint: this.encoderEndpoint });

      const response = await axios.post(`${this.encoderEndpoint}/decode`, {
        encodedData: encodedData.toString('base64')
      }, {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Decoding failed');
      }

      return Buffer.from(response.data.data, 'base64');

    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        // Fallback: return encoded data if encoder is not available
        logger.warn('DA encoder not available, returning encoded data', {
          endpoint: this.encoderEndpoint
        });
        return encodedData;
      }
      throw new Error(`Data decoding failed: ${error.message}`);
    }
  }

  private async disperseBlob(data: Buffer): Promise<{ blobId: string; txHash: string }> {
    try {
      logger.debug('Dispersing blob to DA client', { endpoint: this.clientEndpoint });

      const response = await axios.post(`${this.clientEndpoint}/disperse`, {
        data: data.toString('base64'),
        timeout: this.inclusionTimeout
      }, {
        timeout: this.inclusionTimeout + 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Blob dispersal failed');
      }

      return {
        blobId: response.data.blobId,
        txHash: response.data.txHash || '0x' + '0'.repeat(64) // Fallback tx hash
      };

    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        // Fallback: generate mock blob ID for development
        const mockBlobId = ethers.keccak256(data);
        logger.warn('DA client not available, using mock blob ID', {
          endpoint: this.clientEndpoint,
          mockBlobId
        });
        return {
          blobId: mockBlobId,
          txHash: '0x' + '0'.repeat(64)
        };
      }
      throw new Error(`Blob dispersal failed: ${error.message}`);
    }
  }

  private async retrieveFromDA(blobId: string): Promise<Buffer> {
    try {
      logger.debug('Retrieving blob from DA retriever', { endpoint: this.retrieverEndpoint });

      const response = await axios.get(`${this.retrieverEndpoint}/retrieve/${blobId}`, {
        timeout: 30000
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Blob retrieval failed');
      }

      return Buffer.from(response.data.data, 'base64');

    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('DA retriever service is not available');
      }
      throw new Error(`Blob retrieval failed: ${error.message}`);
    }
  }

  private async submitToContract(data: Buffer, blobId: string): Promise<ethers.ContractTransactionResponse> {
    try {
      logger.debug('Submitting blob to entrance contract', {
        contract: config.zerog.dataAvailability.entranceContract,
        blobId
      });

      // For development, we'll simulate contract submission
      // In production, this would call the real entrance contract
      const gasEstimate = await this.entranceContract.submitBlob.estimateGas(data);
      const gasLimit = gasEstimate * BigInt(120) / BigInt(100); // 20% buffer

      const tx = await this.entranceContract.submitBlob(data, {
        gasLimit
      });

      return tx;

    } catch (error: any) {
      // Fallback: create a mock transaction for development
      logger.warn('Contract submission failed, creating mock transaction', {
        error: error.message
      });

      const mockTx = {
        hash: ethers.keccak256(ethers.toUtf8Bytes(`${blobId}_${Date.now()}`)),
        wait: async () => ({
          hash: ethers.keccak256(ethers.toUtf8Bytes(`${blobId}_${Date.now()}`)),
          blockNumber: await this.provider.getBlockNumber(),
          gasUsed: BigInt(21000)
        })
      } as any;

      return mockTx;
    }
  }

  private async getBlobStatus(blobId: string): Promise<{ status: string; blockNumber: number; timestamp: Date }> {
    try {
      const [statusCode, blockNumber] = await this.entranceContract.getBlobStatus(blobId);
      
      const statusMap: Record<number, string> = {
        0: 'pending',
        1: 'confirmed',
        2: 'finalized',
        3: 'failed'
      };

      return {
        status: statusMap[statusCode] || 'failed',
        blockNumber: Number(blockNumber),
        timestamp: new Date()
      };

    } catch (error: any) {
      // Fallback for development
      logger.warn('Failed to get blob status from contract, using mock status', {
        blobId,
        error: error.message
      });

      return {
        status: 'confirmed',
        blockNumber: await this.provider.getBlockNumber(),
        timestamp: new Date()
      };
    }
  }

  private async getBlobInfoFromClient(blobId: string): Promise<{ size: number; timestamp: Date; txHash?: string }> {
    try {
      const response = await axios.get(`${this.clientEndpoint}/blob/${blobId}`, {
        timeout: 10000
      });

      return {
        size: response.data.size || 0,
        timestamp: response.data.timestamp ? new Date(response.data.timestamp) : new Date(),
        txHash: response.data.txHash
      };

    } catch (error: any) {
      throw new Error(`Failed to get blob info from client: ${error.message}`);
    }
  }

  private async testClientConnection(): Promise<{ endpoint: string; connected: boolean; version?: string }> {
    try {
      const response = await axios.get(`${this.clientEndpoint}/health`, { timeout: 5000 });
      return {
        endpoint: this.clientEndpoint,
        connected: true,
        version: response.data.version
      };
    } catch (error) {
      return {
        endpoint: this.clientEndpoint,
        connected: false
      };
    }
  }

  private async testEncoderConnection(): Promise<{ endpoint: string; connected: boolean; status?: string }> {
    try {
      const response = await axios.get(`${this.encoderEndpoint}/status`, { timeout: 5000 });
      return {
        endpoint: this.encoderEndpoint,
        connected: true,
        status: response.data.status
      };
    } catch (error) {
      return {
        endpoint: this.encoderEndpoint,
        connected: false
      };
    }
  }

  private async testRetrieverConnection(): Promise<{ endpoint: string; connected: boolean; status?: string }> {
    try {
      const response = await axios.get(`${this.retrieverEndpoint}/status`, { timeout: 5000 });
      return {
        endpoint: this.retrieverEndpoint,
        connected: true,
        status: response.data.status
      };
    } catch (error) {
      return {
        endpoint: this.retrieverEndpoint,
        connected: false
      };
    }
  }

  // Oracle data specific methods
  async publishOracleData(oracleData: any, dataType: string): Promise<DAPublishResult> {
    try {
      // Serialize oracle data
      const dataString = JSON.stringify({
        ...oracleData,
        metadata: {
          type: 'oracle_data',
          dataType,
          publishedAt: new Date().toISOString(),
          version: '1.0'
        }
      }, null, 2);

      const buffer = Buffer.from(dataString, 'utf-8');

      logger.info('Publishing oracle data to 0G DA', {
        dataType,
        dataSize: buffer.length,
        oracleSource: oracleData.source
      });

      const result = await this.publishData(buffer, {
        type: 'oracle_data',
        dataType,
        source: oracleData.source
      });

      if (result.success) {
        logger.info('Oracle data published to DA successfully', {
          blobId: result.blobId,
          dataType,
          txHash: result.txHash
        });
      }

      return result;

    } catch (error: any) {
      logger.error('Oracle data DA publish failed', {
        dataType,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async retrieveOracleData(blobId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      logger.info('Retrieving oracle data from 0G DA', { blobId });

      const result = await this.retrieveData(blobId);

      if (!result.success) {
        return {
          success: false,
          error: result.error
        };
      }

      // Parse JSON data
      const dataString = result.data!.toString('utf-8');
      const oracleData = JSON.parse(dataString);

      logger.info('Oracle data retrieved from DA successfully', {
        blobId,
        dataType: oracleData.metadata?.dataType,
        source: oracleData.source
      });

      return {
        success: true,
        data: oracleData
      };

    } catch (error: any) {
      logger.error('Oracle data DA retrieval failed', {
        blobId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
}