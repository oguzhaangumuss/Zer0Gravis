# ZeroGravis

**0G Ecosystem Oracle Data Aggregation Platform**

ZeroGravis is a decentralized oracle data aggregation and consensus platform built on the 0G network. The system collects, stores, and provides consensus for data from multiple oracle sources.

## 🎯 Features

- **🔗 Multi-Oracle Integration**: Chainlink, Weather API, NASA, Crypto APIs
- **💾 Decentralized Storage**: Oracle data persistence with 0G Storage
- **📊 Real-time Data Availability**: Oracle data feeds via 0G DA layer
- **🤖 AI-Powered Consensus**: Oracle data validation and consensus with 0G Compute

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- 0G testnet private key with OG tokens

### Installation

```bash
# Clone repository
git clone <repository-url>
cd ZeroGravis

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your 0G credentials

# Start development server
npm run dev
```

### Environment Setup

```env
# 0G Network Configuration
ZEROG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZEROG_CHAIN_ID=16601
ZEROG_PRIVATE_KEY=your_private_key

# 0G Storage
ZEROG_STORAGE_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZEROG_FLOW_CONTRACT=0xbD75117F80b4E22698D0Cd7612d92BDb8eaff628

# 0G Data Availability
ZEROG_DA_ENTRANCE_CONTRACT=0x857C0A28A8634614BB2C96039Cf4a20AFF709Aa9
```

## 📚 API Documentation

After running the server, access API documentation at:
- **Swagger UI**: http://localhost:3000/api-docs
- **Health Check**: http://localhost:3000/health

## 🏗️ Architecture

```
src/
├── config/          # Configuration management
├── middleware/      # Express middleware
├── routes/          # API route handlers
├── services/        # 0G service integrations
├── utils/           # Utility functions
└── index.ts         # Application entry point
```

## 🔧 Development

```bash
# Development server with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Lint code
npm run lint
```

## 📋 API Endpoints

### Oracle Data Collection
- `POST /api/v1/oracle/collect` - Collect data from multiple oracles
- `GET /api/v1/oracle/data/:type` - Get aggregated oracle data
- `GET /api/v1/oracle/sources` - Available oracle sources

### Data Storage & Retrieval
- `POST /api/v1/storage/store` - Store oracle data in 0G Storage
- `GET /api/v1/storage/retrieve/:hash` - Retrieve stored data

### Data Availability
- `POST /api/v1/da/publish` - Publish oracle data to DA layer
- `GET /api/v1/da/feeds/:feed` - Real-time oracle data feeds

### Consensus & Validation
- `POST /api/v1/consensus/validate` - AI-powered data validation
- `GET /api/v1/consensus/status` - Consensus mechanism status

## 🌐 0G Network Information

- **Network**: 0G-Galileo-Testnet
- **Chain ID**: 16601
- **RPC**: https://evmrpc-testnet.0g.ai
- **Explorer**: https://chainscan-galileo.0g.ai
- **Faucet**: https://faucet.0g.ai

## 🔗 Official Resources

- **0G Documentation**: https://docs.0g.ai/
- **Developer Hub**: https://docs.0g.ai/developer-hub/
- **GitHub**: https://github.com/0glabs

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

**ZeroGravis** - Powered by 0G Ecosystem 🚀