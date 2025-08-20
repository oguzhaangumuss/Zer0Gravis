import { ethers } from 'ethers';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { OracleDataPoint, OracleResponse, PriceFeedData } from '../oracleTypes';

export class ChainlinkAdapter {
  private provider: ethers.Provider;
  
  // Chainlink Price Feed Contract ABI (simplified)
  private readonly priceFeedABI = [
    'function latestRoundData() external view returns (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function description() external view returns (string memory)',
    'function decimals() external view returns (uint8)'
  ];

  // Chainlink price feed contracts on 0G testnet (these would be real addresses)
  private readonly priceFeeds = {
    'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // Example address
    'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c'
  };

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
    logger.info('Chainlink adapter initialized');
  }

  async getPriceFeed(symbol: string): Promise<OracleResponse> {
    const startTime = Date.now();
    
    try {
      const contractAddress = this.priceFeeds[symbol as keyof typeof this.priceFeeds];
      
      if (!contractAddress) {
        throw new Error(`Price feed not available for symbol: ${symbol}`);
      }

      // For development, we'll simulate Chainlink data since we're on 0G testnet
      // In production with real Chainlink contracts, this would be:
      /*
      const priceFeed = new ethers.Contract(contractAddress, this.priceFeedABI, this.provider);
      const [roundId, price, startedAt, updatedAt, answeredInRound] = await priceFeed.latestRoundData();
      const decimals = await priceFeed.decimals();
      const description = await priceFeed.description();
      */

      // Simulated Chainlink data for development
      const simulatedData = await this.simulateChainlinkData(symbol);

      const oracleDataPoint: OracleDataPoint = {
        source: 'chainlink',
        dataType: 'price_feed',
        value: simulatedData,
        timestamp: Date.now(),
        confidence: 0.95, // Chainlink has high confidence
        metadata: {
          symbol: symbol,
          decimals: simulatedData.decimals,
          roundId: simulatedData.roundId,
          updatedAt: simulatedData.updatedAt
        }
      };

      logger.info('Chainlink price feed retrieved', {
        symbol,
        price: simulatedData.price,
        timestamp: oracleDataPoint.timestamp
      });

      return {
        success: true,
        data: oracleDataPoint,
        source: 'chainlink',
        timestamp: Date.now(),
        responseTime: Date.now() - startTime
      };

    } catch (error: any) {
      logger.error('Chainlink adapter error', {
        symbol,
        error: error.message,
        responseTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error.message,
        source: 'chainlink',
        timestamp: Date.now(),
        responseTime: Date.now() - startTime
      };
    }
  }

  private async simulateChainlinkData(symbol: string): Promise<PriceFeedData & { decimals: number; roundId: string; updatedAt: number }> {
    // Simulate realistic price data for development
    const basePrices: Record<string, number> = {
      'ETH/USD': 2500,
      'BTC/USD': 45000,
      'LINK/USD': 15,
      'ADA/USD': 0.5,
      'DOT/USD': 8
    };

    const basePrice = basePrices[symbol] || 100;
    
    // Add some random variation (+/- 2%)
    const variation = (Math.random() - 0.5) * 0.04;
    const price = basePrice * (1 + variation);
    
    // Simulate 24h change
    const change24h = (Math.random() - 0.5) * 0.1; // +/- 10%
    
    return {
      symbol: symbol,
      price: Math.round(price * 100) / 100,
      currency: 'USD',
      change24h: Math.round(change24h * 10000) / 100, // Percentage
      volume24h: Math.floor(Math.random() * 1000000000), // Random volume
      marketCap: Math.floor(Math.random() * 100000000000), // Random market cap
      decimals: 8,
      roundId: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
      updatedAt: Math.floor(Date.now() / 1000)
    };
  }

  async getMultiplePriceFeeds(symbols: string[]): Promise<OracleResponse[]> {
    const promises = symbols.map(symbol => this.getPriceFeed(symbol));
    return await Promise.all(promises);
  }

  async getAvailableFeeds(): Promise<string[]> {
    return Object.keys(this.priceFeeds);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      logger.info('Chainlink adapter connection test successful');
      return true;
    } catch (error: any) {
      logger.error('Chainlink adapter connection test failed', { error: error.message });
      return false;
    }
  }

  async getProviderInfo(): Promise<any> {
    try {
      const [blockNumber, network] = await Promise.all([
        this.provider.getBlockNumber(),
        this.provider.getNetwork()
      ]);

      return {
        provider: 'chainlink',
        blockNumber,
        chainId: network.chainId.toString(),
        availableFeeds: this.getAvailableFeeds(),
        status: 'connected'
      };
    } catch (error: any) {
      return {
        provider: 'chainlink',
        status: 'disconnected',
        error: error.message
      };
    }
  }
}