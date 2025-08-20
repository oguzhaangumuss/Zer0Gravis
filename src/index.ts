import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

// Load environment variables
dotenv.config();

// Import configuration
import { config } from './config';
import { logger } from './utils/logger';

// Import error handling
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';

const app = express();
const port = config.server.port;

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true
}));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ZeroGravis API',
      version: '1.0.0',
      description: '0G Ecosystem Blockchain Analytics Platform API',
      contact: {
        name: '0G Hackathon Team'
      }
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: 'Development server'
      }
    ]
  },
  apis: ['./src/routes/*.ts']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'ZeroGravis'
  });
});

// API routes will be added here
const apiPrefix = config.server.apiPrefix;

// TODO: Add routes
// app.use(`${apiPrefix}/oracle`, oracleRoutes);
// app.use(`${apiPrefix}/storage`, storageRoutes);
// app.use(`${apiPrefix}/da`, daRoutes);
// app.use(`${apiPrefix}/consensus`, consensusRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(port, () => {
  logger.info(`🚀 ZeroGravis server running on port ${port}`);
  logger.info(`📚 API Documentation: http://localhost:${port}/api-docs`);
  logger.info(`🏥 Health Check: http://localhost:${port}/health`);
  logger.info(`🔗 0G Chain RPC: ${config.zerog.chain.rpc}`);
  logger.info(`💾 0G Storage Indexer: ${config.zerog.storage.indexerRpc}`);
});

export default app;