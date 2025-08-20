import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface ServerConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  apiPrefix: string;
  corsOrigin: string;
}

interface ZeroGChainConfig {
  rpc: string;
  chainId: number;
  privateKey: string;
}

interface ZeroGStorageConfig {
  indexerRpc: string;
  flowContract: string;
  replicationCount: number;
  verificationEnabled: boolean;
}

interface ZeroGDAConfig {
  entranceContract: string;
  clientEndpoint: string;
  encoderEndpoint: string;
  retrieverEndpoint: string;
  maxBlobSize: number;
  batchSizeLimit: number;
  inclusionTimeout: number;
}

interface ZeroGComputeConfig {
  contract: string;
  defaultModel: string;
  maxTokensDefault: number;
  teeVerificationEnabled: boolean;
}

interface ZeroGConfig {
  chain: ZeroGChainConfig;
  storage: ZeroGStorageConfig;
  dataAvailability: ZeroGDAConfig;
  compute: ZeroGComputeConfig;
}

interface AppConfig {
  server: ServerConfig;
  zerog: ZeroGConfig;
}

// Validate required environment variables
const requiredEnvVars = [
  'ZEROG_CHAIN_RPC',
  'ZEROG_PRIVATE_KEY',
  'ZEROG_STORAGE_INDEXER_RPC',
  'ZEROG_FLOW_CONTRACT',
  'ZEROG_DA_ENTRANCE_CONTRACT'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export const config: AppConfig = {
  server: {
    port: parseInt(process.env.PORT || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    apiPrefix: process.env.API_PREFIX || '/api/v1',
    corsOrigin: process.env.CORS_ORIGIN || '*'
  },
  
  zerog: {
    chain: {
      rpc: process.env.ZEROG_CHAIN_RPC!,
      chainId: parseInt(process.env.ZEROG_CHAIN_ID || '16601'),
      privateKey: process.env.ZEROG_PRIVATE_KEY!
    },
    
    storage: {
      indexerRpc: process.env.ZEROG_STORAGE_INDEXER_RPC!,
      flowContract: process.env.ZEROG_FLOW_CONTRACT!,
      replicationCount: parseInt(process.env.STORAGE_REPLICATION_COUNT || '3'),
      verificationEnabled: process.env.STORAGE_VERIFICATION_ENABLED === 'true'
    },
    
    dataAvailability: {
      entranceContract: process.env.ZEROG_DA_ENTRANCE_CONTRACT!,
      clientEndpoint: process.env.DA_CLIENT_ENDPOINT || 'http://localhost:51001',
      encoderEndpoint: process.env.DA_ENCODER_ENDPOINT || 'http://localhost:34000',
      retrieverEndpoint: process.env.DA_RETRIEVER_ENDPOINT || 'http://localhost:34005',
      maxBlobSize: parseInt(process.env.DA_MAX_BLOB_SIZE || '33554432'), // 32MB
      batchSizeLimit: parseInt(process.env.DA_BATCH_SIZE_LIMIT || '500'),
      inclusionTimeout: parseInt(process.env.DA_INCLUSION_TIMEOUT || '180000') // 3 minutes
    },
    
    compute: {
      contract: process.env.ZEROG_COMPUTE_CONTRACT || '0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9',
      defaultModel: process.env.DEFAULT_AI_MODEL || 'llama-3.1-8b-instant',
      maxTokensDefault: parseInt(process.env.MAX_TOKENS_DEFAULT || '150'),
      teeVerificationEnabled: process.env.TEE_VERIFICATION_ENABLED === 'true'
    }
  }
};

export default config;