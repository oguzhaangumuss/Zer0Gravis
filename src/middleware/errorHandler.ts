import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class ZeroGravisError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: any) {
    super(message);
    this.name = 'ZeroGravisError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ChainError extends ZeroGravisError {
  constructor(message: string, details?: any) {
    super(message, 503, 'CHAIN_ERROR', details);
    this.name = 'ChainError';
  }
}

export class StorageError extends ZeroGravisError {
  constructor(message: string, details?: any) {
    super(message, 503, 'STORAGE_ERROR', details);
    this.name = 'StorageError';
  }
}

export class DAError extends ZeroGravisError {
  constructor(message: string, details?: any) {
    super(message, 503, 'DA_ERROR', details);
    this.name = 'DAError';
  }
}

export class ComputeError extends ZeroGravisError {
  constructor(message: string, details?: any) {
    super(message, 503, 'COMPUTE_ERROR', details);
    this.name = 'ComputeError';
  }
}

export class ValidationError extends ZeroGravisError {
  constructor(message: string, field?: string) {
    super(message, 400, 'VALIDATION_ERROR', { field });
    this.name = 'ValidationError';
  }
}

export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log the error
  logger.error('Request failed', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }
  });

  // Handle ZeroGravis custom errors
  if (error instanceof ZeroGravisError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details })
      },
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle ethers.js errors
  if (error.code && (error.code.includes('CALL_EXCEPTION') || error.code.includes('NETWORK_ERROR'))) {
    res.status(503).json({
      success: false,
      error: {
        code: 'BLOCKCHAIN_ERROR',
        message: 'Blockchain network error',
        details: error.reason || error.message
      },
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle validation errors (from express-validator or similar)
  if (error.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.errors || error.details
      },
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Handle multer errors (file upload)
  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds limit'
      },
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    },
    timestamp: new Date().toISOString()
  });
};