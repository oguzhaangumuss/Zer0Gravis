import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

// Custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (stack) {
    msg += `\n${stack}`;
  }
  
  if (Object.keys(metadata).length > 0) {
    msg += `\n${JSON.stringify(metadata, null, 2)}`;
  }
  
  return msg;
});

// Create logger instance
export const logger = winston.createLogger({
  level: config.server.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    json()
  ),
  defaultMeta: {
    service: 'ZeroGravis',
    version: '1.0.0'
  },
  transports: [
    // File transport for all logs
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: combine(
        timestamp(),
        errors({ stack: true }),
        json()
      )
    }),
    
    // File transport for combined logs
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      format: combine(
        timestamp(),
        json()
      )
    })
  ]
});

// Add console transport for non-production environments
if (config.server.nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      consoleFormat
    )
  }));
}

export default logger;