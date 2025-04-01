// src/index.ts
import { createModbusConnection } from "./modbus_tcp_service";
import rawConfig from "./config.json";
import { AppConfig, ModbusRegister } from "./types/modbus";
import dotenv from "dotenv";
import { Buffer } from 'buffer';

dotenv.config();

const config = rawConfig as AppConfig;

function convertModbusResponseToFloat(registerValues: number[]): number {
  if (registerValues.length !== 2) {
    throw new Error('Invalid number of registers for float conversion');
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt16BE(registerValues[0], 0);
  buffer.writeUInt16BE(registerValues[1], 2);
  return buffer.readFloatBE(0);
}

async function testBessAcVoltages() {
  let connection: any = null;
  try {
    const bessAcConfig = config.components.bess_ac;
    connection = createModbusConnection(bessAcConfig);

    console.log(`Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`);
    await connection.connect();
    console.log("Modbus connection established successfully!");

    await new Promise(resolve => setTimeout(resolve, 200));

    const voltageRegisters: ModbusRegister[] = [
      { address: 1, desc: "voltage_phase_r", type: "input", data_type: "float", multiplier: 1 },
      { address: 3, desc: "voltage_phase_y", type: "input", data_type: "float", multiplier: 1 },
      { address: 5, desc: "voltage_phase_b", type: "input", data_type: "float", multiplier: 1 },
      { address: 9, desc: "voltage_ry", type: "input", data_type: "float", multiplier: 1 },
      { address: 11, desc: "voltage_yb", type: "input", data_type: "float", multiplier: 1 },
      { address: 13, desc: "voltage_br", type: "input", data_type: "float", multiplier: 1 }
    ];

    console.log("\nTesting BESS AC Voltage Registers:");
    console.log("--------------------------------");

    for (const register of voltageRegisters) {
      try {
        // Using readRegister as defined in your interface
        const rawValues = await connection.readRegister(register);
        
        if (!Array.isArray(rawValues) || rawValues.length < 2) {
          throw new Error(`Expected array of 2 numbers, got ${JSON.stringify(rawValues)}`);
        }

        const voltage = convertModbusResponseToFloat(rawValues) * register.multiplier;

        console.log(
          `${register.desc.padEnd(15)}: ${voltage.toFixed(2).padStart(7)} V ` +
          `(Address: ${register.address})`
        );
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Failed to read ${register.desc}:`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.error("❌ Modbus operation failed:", error instanceof Error ? error.message : error);
  } finally {
    if (connection && typeof connection.close === 'function') {
      try {
        await connection.close();
        console.log("Connection closed");
      } catch (closeError) {
        console.error("Error closing connection:", closeError instanceof Error ? closeError.message : closeError);
      }
    }
    console.log("\nTest completed");
  }
}

testBessAcVoltages();