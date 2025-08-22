import { logger } from '../utils/logger';

export interface OracleTransaction {
  id: string;
  hash: string;
  type: string;
  description: string;
  status: 'confirmed' | 'pending' | 'failed';
  timestamp: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  blockNumber: number;
  symbol?: string;
  price?: number;
  dataHash?: string;
}

class TransactionLogger {
  private transactions: OracleTransaction[] = [];
  private readonly maxTransactions = 100; // Keep last 100 transactions

  addTransaction(transaction: Omit<OracleTransaction, 'id' | 'timestamp'>) {
    const oracleTransaction: OracleTransaction = {
      ...transaction,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };

    // Add to beginning of array (newest first)
    this.transactions.unshift(oracleTransaction);

    // Keep only the most recent transactions
    if (this.transactions.length > this.maxTransactions) {
      this.transactions = this.transactions.slice(0, this.maxTransactions);
    }

    logger.info('Oracle transaction logged', {
      id: oracleTransaction.id,
      type: oracleTransaction.type,
      hash: oracleTransaction.hash
    });

    return oracleTransaction;
  }

  getRecentTransactions(limit: number = 20, type?: string): OracleTransaction[] {
    let filtered = this.transactions;

    // Filter by type if specified
    if (type && type !== 'all') {
      filtered = this.transactions.filter(tx => {
        switch (type) {
          case 'oracle':
            return tx.type.includes('Oracle') || tx.type.includes('Data');
          case 'storage':
            return tx.type.includes('Storage');
          case 'compute':
            return tx.type.includes('AI') || tx.type.includes('Compute');
          default:
            return true;
        }
      });
    }

    return filtered.slice(0, limit);
  }

  getTransactionById(id: string): OracleTransaction | null {
    return this.transactions.find(tx => tx.id === id) || null;
  }

  getTransactionByHash(hash: string): OracleTransaction | null {
    return this.transactions.find(tx => tx.hash === hash) || null;
  }

  getTransactionStats() {
    const total = this.transactions.length;
    const confirmed = this.transactions.filter(tx => tx.status === 'confirmed').length;
    const pending = this.transactions.filter(tx => tx.status === 'pending').length;
    const failed = this.transactions.filter(tx => tx.status === 'failed').length;

    const oracleTransactions = this.transactions.filter(tx => 
      tx.type.includes('Oracle') || tx.type.includes('Data')).length;
    const storageTransactions = this.transactions.filter(tx => 
      tx.type.includes('Storage')).length;
    const computeTransactions = this.transactions.filter(tx => 
      tx.type.includes('AI') || tx.type.includes('Compute')).length;

    return {
      totalTransactions: total,
      confirmedTransactions: confirmed,
      pendingTransactions: pending,
      failedTransactions: failed,
      oracleTransactions,
      storageTransactions,
      computeTransactions,
      successRate: total > 0 ? Math.round((confirmed / total) * 100) : 0
    };
  }

  private generateId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const transactionLogger = new TransactionLogger();