// src/index.ts
import { createModbusConnection } from "./modbus_tcp_service";
import rawConfig from "./config.json";

import dotenv from "dotenv";
import { assertConfig } from "./config-validator";
import { AppConfig } from "./types/modbus";

dotenv.config();

// Validate and type-assert the config
assertConfig(rawConfig);
const config = rawConfig as AppConfig;

async function main() {
  try {
    // Now TypeScript knows config.components.bess is properly typed
    const connection = createModbusConnection(config.components.bess);
    await connection.connect();

    // Rest of your code...
  } catch (error) {
    console.error("Application error:", error);
  }
}

main();
