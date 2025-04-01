import ModbusRTU from "modbus-serial"; // jsmodbus library
import { Buffer } from "buffer";
import { DeviceConfig, RegisterType, ModbusDataType } from "./types/modbus";

const bessAcConfig: DeviceConfig = {
  name: "BESS",
  ip: "192.168.1.202",
  port: 2,  // Modbus TCP default port
  unit_id: 1,
  registers: [
    { address: 1, desc: "voltage_phase_r", type: "input", data_type: "float", multiplier: 1 },
    { address: 3, desc: "voltage_phase_y", type: "input", data_type: "float", multiplier: 1 },
    { address: 5, desc: "voltage_phase_b", type: "input", data_type: "float", multiplier: 1 },
    { address: 9, desc: "voltage_ry", type: "input", data_type: "float", multiplier: 1 },
    { address: 11, desc: "voltage_yb", type: "input", data_type: "float", multiplier: 1 },
    { address: 13, desc: "voltage_br", type: "input", data_type: "float", multiplier: 1 },
  ],
};

async function testBessAcVoltages() {
  const client = new ModbusRTU();
  
  try {
    console.log(`Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`);
    await client.connectTCP(bessAcConfig.ip, { port: bessAcConfig.port });
    client.setID(bessAcConfig.unit_id);
    console.log("Modbus connection established successfully!\n");

    for (const register of bessAcConfig.registers) {
      try {
        // Read 2 registers for float values (16-bit registers)
        const rawValues = await client.readInputRegisters(register.address - 1, 2); // 0-based addressing

        console.log(`${register.desc} (Address: ${register.address}):`);
        console.log(`  Raw Values:`, rawValues); // Log the full rawValues object

        if (rawValues && rawValues.data) {
          // Combine the two 16-bit registers into a 32-bit value (little-endian)
          const combinedBuffer = Buffer.alloc(4);
          combinedBuffer.writeUInt16LE(rawValues.data[0], 0);  // First 16-bit register (little-endian)
          combinedBuffer.writeUInt16LE(rawValues.data[1], 2);  // Second 16-bit register (little-endian)
          
          // Convert the combined buffer to a float (Little Endian)
          const voltage = combinedBuffer.readFloatLE(0);  // Use readFloatLE for Little Endian float

          // Apply multiplier and log the result
          const finalVoltage = voltage * register.multiplier;
          console.log(`  Voltage: ${finalVoltage.toFixed(2)} V`);
        } else {
          console.error(`  Error: No data received from register ${register.address}`);
        }

        // Small delay between reads
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        console.error(
          `❌ Failed to read ${register.desc}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Modbus operation failed:",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    try {
      client.close();
      console.log("\nConnection closed");
    } catch (closeError) {
      console.error(
        "Error closing connection:",
        closeError instanceof Error ? closeError.message : String(closeError)
      );
    }
    console.log("Test completed");
  }
}

testBessAcVoltages();
