import request from 'supertest';
import app from '../index';
import { logger } from '../utils/logger';

describe('ZeroGravis Integration Tests', () => {
  let server: any;
  let testBlobId: string;
  let testRootHash: string;
  let testJobId: string;

  beforeAll(async () => {
    // Start the server for testing
    server = app.listen(0); // Use port 0 to let the OS assign a free port
    logger.info('Test server started for integration tests');
  });

  afterAll(async () => {
    if (server) {
      server.close();
      logger.info('Test server stopped');
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'ZeroGravis'
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Oracle Data Collection', () => {
    it('should collect price feed data from Chainlink', async () => {
      const response = await request(app)
        .post('/api/v1/oracle/collect')
        .send({
          dataType: 'price_feed',
          sources: ['chainlink'],
          parameters: {
            symbol: 'ETH/USD'
          },
          consensusMethod: 'weighted_average'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.dataType).toBe('price_feed');
      expect(response.body.sourcesUsed).toContain('chainlink');
      expect(response.body.executionTime).toBeGreaterThan(0);

      logger.info('Oracle data collection test passed', {
        dataType: response.body.data.dataType,
        executionTime: response.body.executionTime
      });
    });

    it('should collect weather data', async () => {
      const response = await request(app)
        .post('/api/v1/oracle/collect')
        .send({
          dataType: 'weather',
          sources: ['weather'],
          parameters: {
            city: 'London'
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.dataType).toBe('weather');
      expect(response.body.sourcesUsed).toContain('weather');
    });

    it('should collect space data from NASA', async () => {
      const response = await request(app)
        .post('/api/v1/oracle/collect')
        .send({
          dataType: 'space',
          sources: ['nasa'],
          parameters: {
            spaceDataType: 'apod'
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.dataType).toBe('space');
      expect(response.body.sourcesUsed).toContain('nasa');
    });

    it('should get available oracle sources', async () => {
      const response = await request(app)
        .get('/api/v1/oracle/sources')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.count).toBeGreaterThan(0);
    });

    it('should check oracle health', async () => {
      const response = await request(app)
        .get('/api/v1/oracle/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.totalCount).toBeGreaterThan(0);
    });
  });

  describe('0G Chain Integration', () => {
    it('should submit oracle data to chain', async () => {
      const response = await request(app)
        .post('/api/v1/chain/submit')
        .send({
          source: 'test',
          dataType: 'price_feed',
          value: {
            symbol: 'ETH/USD',
            price: 2500.50,
            timestamp: Date.now()
          },
          timestamp: Date.now()
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.dataHash).toBeDefined();
      expect(response.body.data.transactionHash).toBeDefined();

      logger.info('Chain submission test passed', {
        dataHash: response.body.data.dataHash,
        txHash: response.body.data.transactionHash
      });
    });

    it('should get network status', async () => {
      const response = await request(app)
        .get('/api/v1/chain/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.network).toBeDefined();
      expect(response.body.data.wallet).toBeDefined();
    });

    it('should get wallet information', async () => {
      const response = await request(app)
        .get('/api/v1/chain/wallet')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.address).toBeDefined();
      expect(response.body.data.balance).toBeDefined();
      expect(response.body.data.network).toBe('0G-Galileo-Testnet');
    });
  });

  describe('0G Storage Integration', () => {
    const testData = {
      dataType: 'test',
      message: 'Hello 0G Storage!',
      timestamp: Date.now()
    };

    it('should upload JSON data to storage', async () => {
      const response = await request(app)
        .post('/api/v1/storage/upload-data')
        .send({
          data: testData,
          fileName: 'integration-test.json'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.rootHash).toBeDefined();
      expect(response.body.data.txHash).toBeDefined();
      expect(response.body.data.fileName).toBe('integration-test.json');

      testRootHash = response.body.data.rootHash;

      logger.info('Storage upload test passed', {
        rootHash: testRootHash,
        fileName: response.body.data.fileName
      });
    });

    it('should retrieve JSON data from storage', async () => {
      if (!testRootHash) {
        throw new Error('Test root hash not available');
      }

      const response = await request(app)
        .get(`/api/v1/storage/data/${testRootHash}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.message).toBe(testData.message);
      expect(response.body.rootHash).toBe(testRootHash);

      logger.info('Storage retrieval test passed', {
        rootHash: testRootHash,
        verified: true
      });
    });

    it('should get storage network information', async () => {
      const response = await request(app)
        .get('/api/v1/storage/info')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.indexer).toBeDefined();
      expect(response.body.data.wallet).toBeDefined();
    });

    it('should estimate storage costs', async () => {
      const response = await request(app)
        .post('/api/v1/storage/estimate-cost')
        .send({
          fileSize: 1024 // 1KB
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalCost).toBeDefined();
      expect(response.body.data.currency).toBe('OG');
    });
  });

  describe('0G Data Availability Integration', () => {
    const testDAData = {
      type: 'integration_test',
      message: 'Hello 0G Data Availability!',
      timestamp: Date.now()
    };

    it('should publish data to DA layer', async () => {
      const response = await request(app)
        .post('/api/v1/da/publish-data')
        .send({
          data: testDAData,
          metadata: {
            testType: 'integration',
            component: 'da'
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.blobId).toBeDefined();
      expect(response.body.data.txHash).toBeDefined();

      testBlobId = response.body.data.blobId;

      logger.info('DA publish test passed', {
        blobId: testBlobId,
        dataSize: response.body.data.dataSize
      });
    });

    it('should retrieve data from DA layer', async () => {
      if (!testBlobId) {
        throw new Error('Test blob ID not available');
      }

      // Wait a moment for DA propagation
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await request(app)
        .get(`/api/v1/da/retrieve/${testBlobId}?format=json`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.message).toBe(testDAData.message);
      expect(response.body.blobId).toBe(testBlobId);

      logger.info('DA retrieval test passed', {
        blobId: testBlobId,
        verified: true
      });
    });

    it('should get blob information', async () => {
      if (!testBlobId) {
        throw new Error('Test blob ID not available');
      }

      const response = await request(app)
        .get(`/api/v1/da/blob/${testBlobId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.blobId).toBe(testBlobId);
      expect(response.body.data.status).toBeDefined();
    });

    it('should get DA network status', async () => {
      const response = await request(app)
        .get('/api/v1/da/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.client).toBeDefined();
      expect(response.body.data.network).toBeDefined();
    });

    it('should test DA layer end-to-end', async () => {
      const response = await request(app)
        .post('/api/v1/da/test')
        .send({
          testData: 'Integration test data for DA layer'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toBeDefined();
      expect(response.body.results.publish.success).toBe(true);
      expect(response.body.results.verified).toBe(true);

      logger.info('DA end-to-end test passed', {
        publishSuccess: response.body.results.publish.success,
        retrieveSuccess: response.body.results.retrieve.success,
        verified: response.body.results.verified
      });
    });
  });

  describe('0G Compute Integration', () => {
    it('should submit AI inference job', async () => {
      const response = await request(app)
        .post('/api/v1/compute/inference')
        .send({
          model: 'llama-3.1-8b-instant',
          prompt: 'What is the result of 2+2? Give a brief answer.',
          maxTokens: 50,
          temperature: 0.1
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.jobId).toBeDefined();
      expect(response.body.data.result).toBeDefined();
      expect(response.body.data.result.response).toBeDefined();

      testJobId = response.body.data.jobId;

      logger.info('Compute inference test passed', {
        jobId: testJobId,
        model: response.body.data.result.model,
        tokensUsed: response.body.data.result.tokensUsed
      });
    });

    it('should get job information', async () => {
      if (!testJobId) {
        throw new Error('Test job ID not available');
      }

      const response = await request(app)
        .get(`/api/v1/compute/job/${testJobId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.jobId).toBe(testJobId);
      expect(response.body.data.status).toBeDefined();
    });

    it('should perform oracle consensus analysis', async () => {
      const response = await request(app)
        .post('/api/v1/compute/oracle-consensus')
        .send({
          oracleResponses: [
            {
              source: 'chainlink',
              data: { symbol: 'ETH/USD', price: 2500.50 },
              confidence: 0.95,
              timestamp: Date.now()
            },
            {
              source: 'coinbase',
              data: { symbol: 'ETH/USD', price: 2499.80 },
              confidence: 0.90,
              timestamp: Date.now()
            },
            {
              source: 'binance',
              data: { symbol: 'ETH/USD', price: 2501.20 },
              confidence: 0.92,
              timestamp: Date.now()
            }
          ],
          consensusMethod: 'ai_weighted',
          dataType: 'price_feed',
          additionalContext: 'Normal market conditions'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.consensusValue).toBeDefined();
      expect(response.body.data.confidence).toBeGreaterThan(0);
      expect(response.body.data.jobId).toBeDefined();

      logger.info('Compute oracle consensus test passed', {
        confidence: response.body.data.confidence,
        consensusMethod: 'ai_weighted'
      });
    });

    it('should get available models', async () => {
      const response = await request(app)
        .get('/api/v1/compute/models')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].name).toBeDefined();
      expect(response.body.data[0].description).toBeDefined();
    });

    it('should get compute network status', async () => {
      const response = await request(app)
        .get('/api/v1/compute/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.contract).toBeDefined();
      expect(response.body.data.availableModels).toBeDefined();
      expect(response.body.data.status).toBeDefined();
    });

    it('should estimate compute costs', async () => {
      const response = await request(app)
        .post('/api/v1/compute/estimate-cost')
        .send({
          model: 'llama-3.1-8b-instant',
          maxTokens: 200,
          teeVerification: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalCost).toBeDefined();
      expect(response.body.data.currency).toBe('OG');
    });

    it('should test compute network', async () => {
      const response = await request(app)
        .post('/api/v1/compute/test')
        .send({
          model: 'llama-3.1-8b-instant',
          prompt: 'Test prompt for integration testing'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toBeDefined();
      expect(response.body.results.inference.success).toBe(true);

      logger.info('Compute network test passed', {
        inferenceSuccess: response.body.results.inference.success,
        totalTestTime: response.body.results.totalTestTime
      });
    });
  });

  describe('End-to-End Oracle Workflow', () => {
    it('should complete full oracle data lifecycle', async () => {
      logger.info('Starting end-to-end oracle workflow test');

      // Step 1: Collect oracle data
      const collectResponse = await request(app)
        .post('/api/v1/oracle/collect')
        .send({
          dataType: 'price_feed',
          sources: ['chainlink'],
          parameters: { symbol: 'ETH/USD' },
          consensusMethod: 'weighted_average'
        })
        .expect(200);

      expect(collectResponse.body.success).toBe(true);
      const oracleData = collectResponse.body.data;

      // Step 2: Submit to 0G Chain
      const chainResponse = await request(app)
        .post('/api/v1/chain/submit')
        .send({
          source: 'oracle_service',
          dataType: 'aggregated_price_feed',
          value: oracleData,
          timestamp: Date.now()
        })
        .expect(200);

      expect(chainResponse.body.success).toBe(true);
      const chainData = chainResponse.body.data;

      // Step 3: Store in 0G Storage
      const storageResponse = await request(app)
        .post('/api/v1/storage/upload-data')
        .send({
          data: {
            oracleData,
            chainSubmission: chainData,
            metadata: {
              workflow: 'end-to-end',
              timestamp: Date.now()
            }
          },
          fileName: 'e2e-oracle-workflow.json'
        })
        .expect(200);

      expect(storageResponse.body.success).toBe(true);
      const storageData = storageResponse.body.data;

      // Step 4: Publish to 0G DA
      const daResponse = await request(app)
        .post('/api/v1/da/publish-oracle')
        .send({
          oracleData: {
            ...oracleData,
            chainHash: chainData.dataHash,
            storageHash: storageData.rootHash
          },
          dataType: 'price_feed'
        })
        .expect(200);

      expect(daResponse.body.success).toBe(true);
      const daData = daResponse.body.data;

      // Step 5: AI Analysis with 0G Compute
      const computeResponse = await request(app)
        .post('/api/v1/compute/oracle-consensus')
        .send({
          oracleResponses: [
            {
              source: 'chainlink',
              data: oracleData.aggregatedValue,
              confidence: oracleData.confidence,
              timestamp: Date.now()
            }
          ],
          consensusMethod: 'ai_weighted',
          dataType: 'price_feed',
          additionalContext: 'End-to-end workflow validation'
        })
        .expect(200);

      expect(computeResponse.body.success).toBe(true);

      logger.info('End-to-end oracle workflow completed successfully', {
        oracleDataType: oracleData.dataType,
        chainTxHash: chainData.transactionHash,
        storageRootHash: storageData.rootHash,
        daBlobId: daData.blobId,
        aiConsensusJobId: computeResponse.body.data.jobId,
        totalComponents: 4
      });

      // Verify all components are working together
      expect(oracleData.dataType).toBe('price_feed');
      expect(chainData.transactionHash).toBeDefined();
      expect(storageData.rootHash).toBeDefined();
      expect(daData.blobId).toBeDefined();
      expect(computeResponse.body.data.consensusValue).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid oracle parameters', async () => {
      await request(app)
        .post('/api/v1/oracle/collect')
        .send({
          dataType: 'invalid_type',
          sources: ['invalid_source']
        })
        .expect(400);
    });

    it('should handle invalid chain data', async () => {
      await request(app)
        .post('/api/v1/chain/submit')
        .send({
          invalidField: 'test'
        })
        .expect(400);
    });

    it('should handle invalid storage requests', async () => {
      await request(app)
        .post('/api/v1/storage/upload-data')
        .send({
          data: null
        })
        .expect(400);
    });

    it('should handle invalid DA requests', async () => {
      await request(app)
        .post('/api/v1/da/publish-data')
        .send({
          invalidData: 'test'
        })
        .expect(400);
    });

    it('should handle invalid compute requests', async () => {
      await request(app)
        .post('/api/v1/compute/inference')
        .send({
          prompt: '' // Empty prompt should fail
        })
        .expect(400);
    });

    it('should handle 404 for non-existent endpoints', async () => {
      await request(app)
        .get('/api/v1/nonexistent')
        .expect(404);
    });
  });
});