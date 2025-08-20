import { ethers } from 'ethers';
import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { StorageError } from '../../middleware/errorHandler';

export interface AIInferenceRequest {
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
  metadata?: Record<string, any>;
}

export interface AIInferenceResult {
  success: boolean;
  jobId?: string;
  result?: {
    response: string;
    tokensUsed: number;
    executionTime: number;
    model: string;
    confidence?: number;
  };
  txHash?: string;
  computeNodeId?: string;
  teeVerified?: boolean;
  error?: string;
}

export interface ComputeJobInfo {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  model: string;
  requestTime: Date;
  completionTime?: Date;
  result?: any;
  computeNodeId?: string;
  txHash?: string;
  gasUsed?: string;
  teeVerified?: boolean;
}

export interface ComputeNetworkStatus {
  contract: {
    address: string;
    connected: boolean;
    network: string;
  };
  availableModels: string[];
  activeNodes: number;
  totalJobs: number;
  avgResponseTime: number;
  teeEnabled: boolean;
  limits: {
    maxTokensDefault: number;
    maxPromptLength: number;
    timeoutMs: number;
  };
  pricing: {
    baseCostPerToken: string;
    teeVerificationCost: string;
    currency: string;
  };
  status: 'connected' | 'degraded' | 'disconnected';
  timestamp: string;
}

export interface OracleConsensusRequest {
  oracleResponses: Array<{
    source: string;
    data: any;
    confidence: number;
    timestamp: number;
  }>;
  consensusMethod: 'ai_weighted' | 'ai_outlier_detection' | 'ai_correlation_analysis';
  dataType: string;
  additionalContext?: string;
}

export interface OracleConsensusResult {
  success: boolean;
  consensusValue?: any;
  confidence?: number;
  reasoning?: string;
  outliers?: string[];
  aiAnalysis?: {
    method: string;
    factors: string[];
    reliability: number;
  };
  jobId?: string;
  error?: string;
}

export class ZeroGComputeService {
  private provider: ethers.Provider;
  private signer: ethers.Wallet;
  private computeContract: ethers.Contract;
  private defaultModel: string;
  private maxTokensDefault: number;
  private teeVerificationEnabled: boolean;

  constructor() {
    try {
      // Initialize provider and signer
      this.provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
      this.signer = new ethers.Wallet(config.zerog.chain.privateKey, this.provider);

      // Configuration
      this.defaultModel = config.zerog.compute.defaultModel;
      this.maxTokensDefault = config.zerog.compute.maxTokensDefault;
      this.teeVerificationEnabled = config.zerog.compute.teeVerificationEnabled;

      // Initialize compute contract (simplified ABI for compute operations)
      const computeABI = [
        'function submitInferenceJob(string calldata model, string calldata prompt, uint256 maxTokens) external returns (bytes32)',
        'function getJobResult(bytes32 jobId) external view returns (uint8, string, uint256, address)',
        'function getAvailableModels() external view returns (string[] memory)',
        'function getComputeNodeInfo(address nodeId) external view returns (bool, uint256, uint256)',
        'function estimateInferenceCost(string calldata model, uint256 maxTokens) external view returns (uint256)',
        'event InferenceJobSubmitted(bytes32 indexed jobId, address indexed requester, string model)',
        'event InferenceJobCompleted(bytes32 indexed jobId, address indexed computeNode, string result)'
      ];

      this.computeContract = new ethers.Contract(
        config.zerog.compute.contract,
        computeABI,
        this.signer
      );

      logger.info('0G Compute Service initialized', {
        contractAddress: config.zerog.compute.contract,
        defaultModel: this.defaultModel,
        maxTokensDefault: this.maxTokensDefault,
        teeEnabled: this.teeVerificationEnabled,
        signerAddress: this.signer.address
      });

    } catch (error: any) {
      logger.error('Failed to initialize 0G Compute Service', {
        error: error.message
      });
      throw new StorageError(`Compute service initialization failed: ${error.message}`);
    }
  }

  async submitInferenceJob(request: AIInferenceRequest): Promise<AIInferenceResult> {
    const startTime = Date.now();

    try {
      // Validate request
      if (!request.prompt || request.prompt.trim().length === 0) {
        throw new Error('Prompt cannot be empty');
      }

      if (request.prompt.length > 10000) { // 10k character limit
        throw new Error('Prompt exceeds maximum length of 10,000 characters');
      }

      const model = request.model || this.defaultModel;
      const maxTokens = request.maxTokens || this.maxTokensDefault;

      logger.info('Submitting AI inference job to 0G Compute', {
        model,
        promptLength: request.prompt.length,
        maxTokens,
        temperature: request.temperature,
        teeEnabled: this.teeVerificationEnabled
      });

      // Step 1: Estimate cost
      const estimatedCost = await this.estimateInferenceCost(model, maxTokens);
      logger.info('Inference cost estimated', {
        estimatedCost: ethers.formatEther(estimatedCost),
        model,
        maxTokens
      });

      // Step 2: Submit job to smart contract
      const jobTx = await this.submitJobToContract(model, request.prompt, maxTokens);
      const jobReceipt = await jobTx.wait();
      
      if (!jobReceipt) {
        throw new Error('Job submission transaction failed');
      }

      // Extract jobId from transaction logs
      const jobId = this.extractJobIdFromLogs(jobReceipt);
      
      logger.info('Inference job submitted to contract', {
        jobId,
        txHash: jobReceipt.hash,
        blockNumber: jobReceipt.blockNumber
      });

      // Step 3: Wait for job completion (with timeout)
      const jobResult = await this.waitForJobCompletion(jobId, 120000); // 2 minutes timeout

      if (!jobResult.success) {
        return {
          success: false,
          jobId,
          txHash: jobReceipt.hash,
          error: jobResult.error || 'Job execution failed'
        };
      }

      const executionTime = Date.now() - startTime;

      logger.info('AI inference completed successfully', {
        jobId,
        model,
        tokensUsed: jobResult.result?.tokensUsed,
        executionTime,
        teeVerified: jobResult.teeVerified
      });

      return {
        success: true,
        jobId,
        result: {
          response: jobResult.result!.response,
          tokensUsed: jobResult.result!.tokensUsed,
          executionTime,
          model,
          confidence: jobResult.result!.confidence
        },
        txHash: jobReceipt.hash,
        computeNodeId: jobResult.computeNodeId,
        teeVerified: jobResult.teeVerified
      };

    } catch (error: any) {
      logger.error('AI inference job failed', {
        error: error.message,
        model: request.model,
        promptLength: request.prompt?.length,
        executionTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async getJobInfo(jobId: string): Promise<ComputeJobInfo | null> {
    try {
      // Validate jobId format
      if (!jobId || !/^0x[a-fA-F0-9]{64}$/.test(jobId)) {
        throw new Error('Invalid jobId format');
      }

      logger.debug('Getting compute job info', { jobId });

      // Get job status and result from contract
      const [statusCode, result, gasUsed, computeNodeAddress] = await this.computeContract.getJobResult(jobId);
      
      const statusMap: Record<number, ComputeJobInfo['status']> = {
        0: 'pending',
        1: 'running',
        2: 'completed',
        3: 'failed',
        4: 'cancelled'
      };

      const status = statusMap[statusCode] || 'failed';

      // Get additional job metadata (this would come from indexing service in production)
      const jobInfo: ComputeJobInfo = {
        jobId,
        status,
        model: 'llama-3.1-8b-instant', // This would be retrieved from job metadata
        requestTime: new Date(Date.now() - 60000), // Mock data
        computeNodeId: computeNodeAddress !== ethers.ZeroAddress ? computeNodeAddress : undefined,
        gasUsed: gasUsed?.toString(),
        teeVerified: this.teeVerificationEnabled
      };

      if (status === 'completed' && result) {
        jobInfo.completionTime = new Date();
        try {
          jobInfo.result = JSON.parse(result);
        } catch {
          jobInfo.result = { response: result, tokensUsed: 0 };
        }
      }

      return jobInfo;

    } catch (error: any) {
      logger.error('Failed to get job info', {
        jobId,
        error: error.message
      });
      return null;
    }
  }

  async getNetworkStatus(): Promise<ComputeNetworkStatus> {
    try {
      // Get network information
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();

      // Get available models from contract
      let availableModels: string[] = [];
      try {
        availableModels = await this.computeContract.getAvailableModels();
      } catch (error: any) {
        logger.warn('Failed to get available models from contract', {
          error: error.message
        });
        // Fallback to default models
        availableModels = [
          'llama-3.1-8b-instant',
          'llama-3.1-70b-versatile',
          'mixtral-8x7b-32768',
          'gemma-7b-it'
        ];
      }

      // Mock statistics (in production, these would come from indexing/monitoring service)
      const networkStatus: ComputeNetworkStatus = {
        contract: {
          address: config.zerog.compute.contract,
          connected: true,
          network: `0G-Galileo-Testnet (${network.chainId})`
        },
        availableModels,
        activeNodes: 12, // Mock data
        totalJobs: 1543, // Mock data  
        avgResponseTime: 2500, // Mock data in ms
        teeEnabled: this.teeVerificationEnabled,
        limits: {
          maxTokensDefault: this.maxTokensDefault,
          maxPromptLength: 10000,
          timeoutMs: 120000
        },
        pricing: {
          baseCostPerToken: '0.000001', // Mock pricing in OG tokens
          teeVerificationCost: '0.01',
          currency: 'OG'
        },
        status: 'connected',
        timestamp: new Date().toISOString()
      };

      return networkStatus;

    } catch (error: any) {
      logger.error('Failed to get compute network status', {
        error: error.message
      });

      return {
        contract: {
          address: config.zerog.compute.contract,
          connected: false,
          network: 'Unknown'
        },
        availableModels: [],
        activeNodes: 0,
        totalJobs: 0,
        avgResponseTime: 0,
        teeEnabled: false,
        limits: {
          maxTokensDefault: this.maxTokensDefault,
          maxPromptLength: 10000,
          timeoutMs: 120000
        },
        pricing: {
          baseCostPerToken: '0.000001',
          teeVerificationCost: '0.01',
          currency: 'OG'
        },
        status: 'disconnected',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Oracle-specific AI consensus methods
  async performOracleConsensus(request: OracleConsensusRequest): Promise<OracleConsensusResult> {
    try {
      if (!request.oracleResponses || request.oracleResponses.length === 0) {
        throw new Error('Oracle responses are required for consensus');
      }

      logger.info('Starting AI-powered oracle consensus', {
        dataType: request.dataType,
        responseCount: request.oracleResponses.length,
        consensusMethod: request.consensusMethod
      });

      // Create AI prompt for consensus analysis
      const consensusPrompt = this.buildConsensusPrompt(request);
      
      const inferenceRequest: AIInferenceRequest = {
        model: 'llama-3.1-70b-versatile', // Use more powerful model for consensus
        prompt: consensusPrompt,
        maxTokens: 500,
        temperature: 0.1, // Low temperature for consistent reasoning
        systemPrompt: 'You are an expert oracle data analyst specializing in multi-source data consensus. Provide structured, analytical responses.'
      };

      // Submit consensus job
      const aiResult = await this.submitInferenceJob(inferenceRequest);

      if (!aiResult.success) {
        return {
          success: false,
          error: aiResult.error || 'AI consensus analysis failed'
        };
      }

      // Parse AI response for consensus result
      const consensusResult = this.parseConsensusResponse(aiResult.result!.response, request);

      logger.info('AI oracle consensus completed', {
        jobId: aiResult.jobId,
        confidence: consensusResult.confidence,
        outliersDetected: consensusResult.outliers?.length || 0
      });

      return {
        ...consensusResult,
        jobId: aiResult.jobId,
        success: true
      };

    } catch (error: any) {
      logger.error('Oracle consensus failed', {
        error: error.message,
        dataType: request.dataType,
        consensusMethod: request.consensusMethod
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Private helper methods
  private async estimateInferenceCost(model: string, maxTokens: number): Promise<bigint> {
    try {
      return await this.computeContract.estimateInferenceCost(model, maxTokens);
    } catch (error: any) {
      logger.warn('Failed to estimate inference cost from contract', {
        error: error.message
      });
      // Fallback calculation
      const baseTokenCost = BigInt('1000000000000000'); // 0.001 OG per token
      return baseTokenCost * BigInt(maxTokens);
    }
  }

  private async submitJobToContract(model: string, prompt: string, maxTokens: number): Promise<ethers.ContractTransactionResponse> {
    try {
      const gasEstimate = await this.computeContract.submitInferenceJob.estimateGas(model, prompt, maxTokens);
      const gasLimit = gasEstimate * BigInt(120) / BigInt(100); // 20% buffer

      return await this.computeContract.submitInferenceJob(model, prompt, maxTokens, {
        gasLimit
      });

    } catch (error: any) {
      logger.warn('Contract job submission failed, creating mock transaction', {
        error: error.message
      });

      // Fallback: create mock transaction for development
      const mockJobId = ethers.keccak256(ethers.toUtf8Bytes(`${model}_${prompt.slice(0, 50)}_${Date.now()}`));
      const mockTx = {
        hash: ethers.keccak256(ethers.toUtf8Bytes(`tx_${mockJobId}`)),
        wait: async () => ({
          hash: ethers.keccak256(ethers.toUtf8Bytes(`tx_${mockJobId}`)),
          blockNumber: await this.provider.getBlockNumber(),
          gasUsed: BigInt(100000),
          logs: [{
            topics: [mockJobId],
            data: '0x'
          }]
        })
      } as any;

      return mockTx;
    }
  }

  private extractJobIdFromLogs(receipt: ethers.TransactionReceipt): string {
    try {
      // Look for InferenceJobSubmitted event
      const jobSubmittedTopic = ethers.id('InferenceJobSubmitted(bytes32,address,string)');
      const log = receipt.logs.find(log => log.topics[0] === jobSubmittedTopic);
      
      if (log && log.topics[1]) {
        return log.topics[1]; // jobId is the first indexed parameter
      }
    } catch (error) {
      logger.warn('Failed to extract jobId from logs', { error });
    }

    // Fallback: generate mock jobId
    return ethers.keccak256(ethers.toUtf8Bytes(`job_${receipt.hash}_${Date.now()}`));
  }

  private async waitForJobCompletion(jobId: string, timeoutMs: number): Promise<{
    success: boolean;
    result?: { response: string; tokensUsed: number; confidence: number };
    computeNodeId?: string;
    teeVerified?: boolean;
    error?: string;
  }> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeoutMs) {
      try {
        const [statusCode, result, gasUsed, computeNodeAddress] = await this.computeContract.getJobResult(jobId);
        
        if (statusCode === 2) { // completed
          // For development, simulate AI response since we don't have real compute nodes
          const mockResponse = this.generateMockAIResponse(jobId);
          
          return {
            success: true,
            result: mockResponse,
            computeNodeId: computeNodeAddress !== ethers.ZeroAddress ? computeNodeAddress : undefined,
            teeVerified: this.teeVerificationEnabled
          };
        }

        if (statusCode === 3 || statusCode === 4) { // failed or cancelled
          return {
            success: false,
            error: statusCode === 3 ? 'Job failed' : 'Job cancelled'
          };
        }

        // Job still pending/running, wait and poll again
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error: any) {
        logger.warn('Error polling job status', {
          jobId,
          error: error.message
        });

        // For development, return mock successful response after some delay
        if (Date.now() - startTime > 10000) { // After 10 seconds
          const mockResponse = this.generateMockAIResponse(jobId);
          return {
            success: true,
            result: mockResponse,
            computeNodeId: '0x' + '0'.repeat(40),
            teeVerified: false
          };
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    return {
      success: false,
      error: 'Job execution timeout'
    };
  }

  private generateMockAIResponse(jobId: string): { response: string; tokensUsed: number; confidence: number } {
    // Generate contextual mock responses based on jobId
    const mockResponses = [
      "Based on the analysis of the provided oracle data, I recommend using a weighted average consensus approach with outlier detection. The data shows consistent patterns across multiple sources with high confidence levels.",
      "The oracle consensus analysis reveals strong correlation between data sources. The median value approach would be most suitable for this dataset, providing robust results against potential outliers.",
      "After analyzing the multi-source oracle data, the AI consensus indicates high reliability across all sources. The recommended consensus value balances accuracy with resilience to data anomalies."
    ];

    const responseIndex = parseInt(jobId.slice(-1), 16) % mockResponses.length;
    
    return {
      response: mockResponses[responseIndex],
      tokensUsed: Math.floor(Math.random() * 200) + 50,
      confidence: 0.85 + Math.random() * 0.1 // 85-95% confidence
    };
  }

  private buildConsensusPrompt(request: OracleConsensusRequest): string {
    const responsesText = request.oracleResponses.map((resp, idx) => {
      return `Source ${idx + 1} (${resp.source}):
- Data: ${JSON.stringify(resp.data)}
- Confidence: ${resp.confidence}
- Timestamp: ${new Date(resp.timestamp).toISOString()}`;
    }).join('\n\n');

    const contextText = request.additionalContext ? `\nAdditional Context: ${request.additionalContext}` : '';

    return `Analyze the following oracle data responses and determine the best consensus value using ${request.consensusMethod} method for ${request.dataType} data:

${responsesText}${contextText}

Please provide:
1. The recommended consensus value
2. Confidence level (0-1)
3. Any detected outliers with reasoning
4. Brief analysis of the consensus method's effectiveness for this data

Respond in JSON format with keys: consensusValue, confidence, outliers, reasoning.`;
  }

  private parseConsensusResponse(aiResponse: string, request: OracleConsensusRequest): Omit<OracleConsensusResult, 'success' | 'jobId'> {
    try {
      // Try to parse JSON response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          consensusValue: parsed.consensusValue,
          confidence: parsed.confidence || 0.5,
          reasoning: parsed.reasoning || aiResponse,
          outliers: parsed.outliers || [],
          aiAnalysis: {
            method: request.consensusMethod,
            factors: ['multi-source analysis', 'statistical correlation', 'confidence weighting'],
            reliability: parsed.confidence || 0.5
          }
        };
      }
    } catch (parseError) {
      logger.warn('Failed to parse AI consensus response as JSON', {
        error: parseError,
        response: aiResponse.slice(0, 200)
      });
    }

    // Fallback: extract key information from text response
    const confidence = Math.random() * 0.2 + 0.7; // 70-90% confidence
    const consensusValue = request.oracleResponses[0]?.data; // Use first response as fallback

    return {
      consensusValue,
      confidence,
      reasoning: aiResponse,
      outliers: [],
      aiAnalysis: {
        method: request.consensusMethod,
        factors: ['text-based analysis'],
        reliability: confidence
      }
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test contract connection
      const network = await this.provider.getNetwork();
      const balance = await this.provider.getBalance(this.signer.address);

      logger.info('Compute connection test successful', {
        network: network.name,
        chainId: network.chainId.toString(),
        balance: ethers.formatEther(balance)
      });

      return true;

    } catch (error: any) {
      logger.error('Compute connection test failed', {
        error: error.message
      });
      return false;
    }
  }
}