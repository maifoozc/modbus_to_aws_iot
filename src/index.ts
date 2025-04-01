// src/index.ts
import { createModbusConnection } from "./modbus_tcp_service";
import rawConfig from "./config.json";
import { AppConfig } from "./types/modbus";
import dotenv from "dotenv";

dotenv.config();

// Type assertion for config
const config = rawConfig as AppConfig;

async function readModbusData() {
  try {
    // 1. Connect to the BESS device
    const bessConfig = config.components.bess;
    const connection = createModbusConnection(bessConfig);

    console.log(
      `Connecting to ${bessConfig.name} at ${bessConfig.ip}:${bessConfig.port}...`
    );
    await connection.connect();
    console.log("Modbus connection established successfully!");

    // 2. Read and display all registers
    console.log("\nReading register data:");
    console.log("----------------------");

    for (const register of bessConfig.registers) {
      try {
        const rawValue = await connection.readRegister(register);
        const scaledValue = rawValue * register.multiplier;

        console.log(
          `${register.desc.padEnd(20)}: ` +
            `Raw: ${rawValue.toString().padStart(6)} | ` +
            `Scaled: ${scaledValue.toFixed(4).padStart(8)} ` +
            `(Addr: ${register.address}, Type: ${register.type})`
        );
      } catch (error) {
        console.error(`Failed to read ${register.desc}:`, error);
      }
    }
  } catch (error) {
    console.error("Modbus operation failed:", error);
  }
}

readModbusData();
