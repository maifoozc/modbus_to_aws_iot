// src/index.ts
import { createModbusConnection } from "./modbus_tcp_service";
import { Buffer } from 'buffer';
import { DeviceConfig, ModbusRegister, RegisterType, ModbusDataType } from "./types/modbus";

// Properly typed configuration
const bessAcConfig: DeviceConfig = {
  name: "BESS",
  ip: "192.168.1.202",
  port: 2,
  unit_id: 1,
  registers: [
    { address: 1, desc: "voltage_phase_r", type: "input" as RegisterType, data_type: "float" as ModbusDataType, multiplier: 1 },
    { address: 3, desc: "voltage_phase_y", type: "input" as RegisterType, data_type: "float" as ModbusDataType, multiplier: 1 },
    { address: 5, desc: "voltage_phase_b", type: "input" as RegisterType, data_type: "float" as ModbusDataType, multiplier: 1 },
    { address: 9, desc: "voltage_ry", type: "input" as RegisterType, data_type: "float" as ModbusDataType, multiplier: 1 },
    { address: 11, desc: "voltage_yb", type: "input" as RegisterType, data_type: "float" as ModbusDataType, multiplier: 1 },
    { address: 13, desc: "voltage_br", type: "input" as RegisterType, data_type: "float" as ModbusDataType, multiplier: 1 }
  ]
};

// Float conversion function
function convertToFloat(rawValues: number[], option: number = 1): number {
  const buffer = Buffer.alloc(4);
  
  switch(option) {
    case 1: // Big-endian (most common)
      buffer.writeUInt16BE(rawValues[0], 0);
      buffer.writeUInt16BE(rawValues[1], 2);
      break;
    case 2: // Word swap
      buffer.writeUInt16BE(rawValues[1], 0);
      buffer.writeUInt16BE(rawValues[0], 2);
      break;
    case 3: // Little-endian
      buffer.writeUInt16LE(rawValues[0], 0);
      buffer.writeUInt16LE(rawValues[1], 2);
      break;
    case 4: // Byte swap
      buffer.writeUInt16BE(rawValues[0], 2);
      buffer.writeUInt16BE(rawValues[1], 0);
      break;
    default:
      throw new Error('Invalid conversion option');
  }
  
  return buffer.readFloatBE(0);
}

async function testBessAcVoltages() {
  let connection: any = null;
  try {
    connection = createModbusConnection(bessAcConfig);

    console.log(`Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`);
    await connection.connect();
    console.log("Modbus connection established successfully!\n");

    for (const register of bessAcConfig.registers) {
      try {
        const rawValues = await connection.readRegister(register);
        console.log(`${register.desc} (Address: ${register.address}):`);
        console.log(`  Raw Values: [${rawValues.join(', ')}]`);
        
        // Test all conversion options
        for (let option = 1; option <= 4; option++) {
          try {
            const voltage = convertToFloat(rawValues, option);
            console.log(`  Option ${option}: ${voltage.toFixed(2)} V`);
          } catch (e) {
            console.log(`  Option ${option}: Failed (${(e as Error).message})`);
          }
        }
        console.log('');
        
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`❌ Failed to read ${register.desc}:`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.error("❌ Modbus operation failed:", error instanceof Error ? error.message : error);
  } finally {
    if (connection?.close) {
      try {
        await connection.close();
        console.log("\nConnection closed");
      } catch (closeError) {
        console.error("Error closing connection:", closeError instanceof Error ? closeError.message : closeError);
      }
    }
    console.log("Test completed");
  }
}

testBessAcVoltages();