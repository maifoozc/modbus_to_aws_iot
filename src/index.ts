// src/index.ts
import { createModbusConnection } from "./modbus_tcp_service";
import rawConfig from "./config.json";
import { AppConfig, ModbusRegister } from "./types/modbus";
import dotenv from "dotenv";

dotenv.config();

// Type assertion for config
const config = rawConfig as AppConfig;

async function testBessAcVoltages() {
  try {
    // 1. Connect to the BESS AC device only
    const bessAcConfig = config.components.bess_ac;
    const connection = createModbusConnection(bessAcConfig);

    console.log(
      `Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`
    );
    await connection.connect();
    console.log("Modbus connection established successfully!");

    // 2. Define only the voltage registers we want to test
    const voltageRegisters: ModbusRegister[] = [
      {
        address: 1,
        desc: "voltage_phase_r",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 3,
        desc: "voltage_phase_y",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 5,
        desc: "voltage_phase_b",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 9,
        desc: "voltage_ry",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 11,
        desc: "voltage_yb",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 13,
        desc: "voltage_br",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
    ];

    // 3. Test only these voltage registers
    console.log("\nTesting BESS AC Voltage Registers:");
    console.log("--------------------------------");

    for (const register of voltageRegisters) {
      try {
        const rawValue = await connection.readRegister(register);
        const voltage = rawValue * register.multiplier;

        console.log(
          `${register.desc.padEnd(15)}: ${voltage.toFixed(2).padStart(7)} V ` +
            `(Address: ${register.address})`
        );
      } catch (error) {
        console.error(`❌ Failed to read ${register.desc}:`, error);
      }
    }
  } catch (error) {
    console.error("❌ Modbus operation failed:", error);
  } finally {
    console.log("\nTest completed");
  }
}

// Run the focused test
testBessAcVoltages();
