import { ethers } from 'ethers';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface WalletInfo {
  address: string;
  balance: string;
  balanceWei: bigint;
  nonce: number;
  isContract: boolean;
}

export interface TransactionRequest {
  to: string;
  value?: bigint;
  data?: string;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export class WalletService {
  private provider: ethers.Provider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.zerog.chain.rpc);
  }

  /**
   * Get wallet information for any address
   */
  async getWalletInfo(address: string): Promise<WalletInfo> {
    try {
      const [balance, nonce, code] = await Promise.all([
        this.provider.getBalance(address),
        this.provider.getTransactionCount(address),
        this.provider.getCode(address)
      ]);

      return {
        address,
        balance: ethers.formatEther(balance),
        balanceWei: balance,
        nonce,
        isContract: code !== '0x'
      };
    } catch (error: any) {
      logger.error('Failed to get wallet info', {
        address,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create signer for backend operations (fallback)
   * This uses the configured private key as fallback when user wallet can't sign
   */
  createBackendSigner(): ethers.Wallet {
    return new ethers.Wallet(config.zerog.chain.privateKey, this.provider);
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(from: string, transaction: TransactionRequest): Promise<bigint> {
    try {
      const gasEstimate = await this.provider.estimateGas({
        from,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data
      });

      // Add 20% buffer for safety
      return gasEstimate + (gasEstimate * BigInt(20) / BigInt(100));
    } catch (error: any) {
      logger.error('Gas estimation failed', {
        from,
        to: transaction.to,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get current gas prices
   */
  async getGasPrice(): Promise<{
    gasPrice: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    try {
      const feeData = await this.provider.getFeeData();
      
      return {
        gasPrice: feeData.gasPrice || BigInt('20000000000'), // 20 gwei fallback
        maxFeePerGas: feeData.maxFeePerGas || BigInt('40000000000'), // 40 gwei fallback
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigInt('2000000000') // 2 gwei fallback
      };
    } catch (error: any) {
      logger.error('Failed to get gas price', { error: error.message });
      
      // Return fallback values
      return {
        gasPrice: BigInt('20000000000'), // 20 gwei
        maxFeePerGas: BigInt('40000000000'), // 40 gwei  
        maxPriorityFeePerGas: BigInt('2000000000') // 2 gwei
      };
    }
  }

  /**
   * Prepare transaction for signing
   * This prepares the transaction but doesn't sign it - signing should happen on frontend
   */
  async prepareTransaction(
    from: string, 
    transaction: TransactionRequest
  ): Promise<{
    to: string;
    value: string;
    data: string;
    gasLimit: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    nonce: number;
    chainId: number;
  }> {
    try {
      const [gasEstimate, gasPrice, nonce] = await Promise.all([
        this.estimateGas(from, transaction),
        this.getGasPrice(),
        this.provider.getTransactionCount(from, 'pending')
      ]);

      return {
        to: transaction.to,
        value: (transaction.value || BigInt(0)).toString(),
        data: transaction.data || '0x',
        gasLimit: (transaction.gasLimit || gasEstimate).toString(),
        maxFeePerGas: (transaction.maxFeePerGas || gasPrice.maxFeePerGas).toString(),
        maxPriorityFeePerGas: (transaction.maxPriorityFeePerGas || gasPrice.maxPriorityFeePerGas).toString(),
        nonce,
        chainId: config.zerog.chain.chainId
      };
    } catch (error: any) {
      logger.error('Transaction preparation failed', {
        from,
        to: transaction.to,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send signed transaction to network
   */
  async broadcastTransaction(signedTx: string): Promise<{
    hash: string;
    receipt?: ethers.TransactionReceipt;
  }> {
    try {
      const tx = await this.provider.broadcastTransaction(signedTx);
      
      logger.info('Transaction broadcasted', {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        gasLimit: tx.gasLimit.toString()
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (receipt) {
        logger.info('Transaction confirmed', {
          hash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status
        });
      }

      return {
        hash: tx.hash,
        receipt: receipt || undefined
      };
    } catch (error: any) {
      logger.error('Transaction broadcast failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if address has sufficient balance for transaction
   */
  async hasInsufficientBalance(address: string, requiredAmount: bigint): Promise<boolean> {
    try {
      const balance = await this.provider.getBalance(address);
      return balance < requiredAmount;
    } catch (error: any) {
      logger.error('Balance check failed', {
        address,
        requiredAmount: requiredAmount.toString(),
        error: error.message
      });
      return true; // Assume insufficient on error for safety
    }
  }

  /**
   * Get network information
   */
  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      return {
        chainId: network.chainId.toString(),
        name: network.name || '0G-Galileo-Testnet',
        blockNumber,
        rpc: config.zerog.chain.rpc
      };
    } catch (error: any) {
      logger.error('Failed to get network info', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const walletService = new WalletService();