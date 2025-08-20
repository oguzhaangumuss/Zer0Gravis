// Jest setup file for ZeroGravis tests

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.ZEROG_CHAIN_RPC = 'http://localhost:8545';
process.env.ZEROG_PRIVATE_KEY = '0x' + '1'.repeat(64);
process.env.ZEROG_STORAGE_INDEXER_RPC = 'http://localhost:5678';
process.env.ZEROG_FLOW_CONTRACT = '0x' + '2'.repeat(40);
process.env.ZEROG_DA_ENTRANCE_CONTRACT = '0x' + '3'.repeat(40);
process.env.ZEROG_COMPUTE_CONTRACT = '0x' + '4'.repeat(40);
process.env.DA_CLIENT_ENDPOINT = 'http://localhost:51001';
process.env.DA_ENCODER_ENDPOINT = 'http://localhost:34000';
process.env.DA_RETRIEVER_ENDPOINT = 'http://localhost:34005';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in test output
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  console.error = jest.fn((message) => {
    if (message.includes('Warning') || message.includes('Error')) {
      // Only show actual errors/warnings, not expected ones in tests
      if (!message.includes('Expected') && !message.includes('Mock')) {
        originalError(message);
      }
    }
  });

  console.warn = jest.fn((message) => {
    if (!message.includes('Mock') && !message.includes('Test')) {
      originalWarn(message);
    }
  });

  console.log = jest.fn((message) => {
    // Suppress most console.log during tests unless it's important
    if (message.includes('IMPORTANT') || message.includes('ERROR')) {
      originalLog(message);
    }
  });
});

afterAll(() => {
  // Restore original console methods
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
});

// Export test utilities as a module to avoid global scope issues